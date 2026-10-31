import Foundation
import SwiftUI
import UIKit

struct DebriefTarget: Identifiable, Hashable { let id: String }

/// App state: the device registration, profile, catalog and the live call.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    let api: HangUpAPI
    @Published var registered: Bool
    @Published var me: Me?
    @Published var catalog: Catalog?
    @Published var activeCall: ActiveCall?
    @Published var debrief: DebriefTarget?
    @Published var banner: String?
    @Published var countdown: Int?
    private var practicing = false
    /// A real phone call we placed; its debrief opens when the user comes back to the app.
    private var phoneCallId: String?

    static let defaultServer = (Bundle.main.object(forInfoDictionaryKey: "HangUpServerURL") as? String) ?? "https://hang-up.onrender.com"

    var serverURL: String {
        get { UserDefaults.standard.string(forKey: "serverURL") ?? Self.defaultServer }
        set {
            UserDefaults.standard.set(newValue, forKey: "serverURL")
            if let u = URL(string: newValue) { api.baseURL = u }
        }
    }

    private init() {
        let token = Keychain.get()
        let url = URL(string: UserDefaults.standard.string(forKey: "serverURL") ?? Self.defaultServer)!
        api = HangUpAPI(baseURL: url, token: token)
        registered = token != nil
        CallManager.shared.model = self
    }

    // MARK: setup

    func register(name: String, safeWord: String) async throws {
        let reg = try await api.register(displayName: name)
        api.token = reg.token
        do {
            me = try await api.updateSettings([
                "displayName": name,
                "safeWord": safeWord,
                "timezone": TimeZone.current.identifier,
                "consentedAt": ISO8601DateFormatter().string(from: Date()),
            ])
        } catch {
            api.token = nil
            throw error
        }
        Keychain.set(reg.token)
        registered = true
        if let t = CallManager.shared.voipToken { registerVoip(token: t) }
    }

    func refresh() async {
        guard registered else { return }
        do {
            async let m = api.me()
            async let c = api.catalog()
            me = try await m
            catalog = try await c
        } catch let e as APIError where e.status == 401 {
            // The server lost this device (for example a wiped demo database): set up again.
            signOut()
        } catch {
            banner = "Couldn't reach Hang Up. \(error.localizedDescription)"
        }
    }

    /// App opened or came to the foreground.
    func didBecomeActive() async {
        guard registered else { return }
        try? await api.opened()
        await refresh()
        await showPhoneDebriefIfReady()
        // A scheduled call that rang while no VoIP push could reach us: ring it now.
        if activeCall == nil, !practicing, let call = try? await api.ringing(), !CallManager.shared.isTracking(callId: call.id) {
            CallManager.shared.reportIncoming(callId: call.id, callerId: call.callerId)
        }
    }

    func signOut() {
        Keychain.set(nil)
        api.token = nil
        registered = false
        me = nil
    }

    func registerVoip(token: String) {
        guard registered else { return }
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        Task { try? await api.registerVoip(token: token, sandbox: sandbox) }
    }

    // MARK: calls

    /// "Practice now": the server creates the call, then the phone rings after `delay` seconds
    /// so there is time to lock the screen and get the full lock-screen call experience.
    func practice(scenarioId: String?, difficulty: Difficulty?, delay: Int) async {
        practicing = true
        defer { practicing = false }
        if me?.ringsPhone == true { return await practiceByPhone(scenarioId: scenarioId, difficulty: difficulty, delay: delay) }
        do {
            let call = try await api.practice(scenarioId: scenarioId, difficulty: difficulty)
            guard delay > 0 else {
                CallManager.shared.reportIncoming(callId: call.id, callerId: call.callerId)
                return
            }
            // Keep running for the countdown if the user locks the phone or leaves the app.
            let bg = UIApplication.shared.beginBackgroundTask(withName: "ring")
            for left in stride(from: delay, to: 0, by: -1) {
                countdown = left
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
            countdown = nil
            CallManager.shared.reportIncoming(callId: call.id, callerId: call.callerId) {
                UIApplication.shared.endBackgroundTask(bg)
            }
        } catch {
            countdown = nil
            banner = error.localizedDescription
        }
    }

    /// Real phone call: count down here, then the server dials the verified number.
    private func practiceByPhone(scenarioId: String?, difficulty: Difficulty?, delay: Int) async {
        let bg = UIApplication.shared.beginBackgroundTask(withName: "dial")
        defer { UIApplication.shared.endBackgroundTask(bg) }
        do {
            for left in stride(from: delay, to: 0, by: -1) {
                countdown = left
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
            countdown = nil
            let call = try await api.practice(scenarioId: scenarioId, difficulty: difficulty, viaPhone: true)
            phoneCallId = call.id
            banner = "Calling your phone now."
        } catch {
            countdown = nil
            banner = error.localizedDescription
        }
    }

    private func showPhoneDebriefIfReady() async {
        guard let id = phoneCallId, debrief == nil, let call = try? await api.call(id).summary else { return }
        switch call.status {
        case "scored":
            phoneCallId = nil
            if call.endReason != .practiceReveal && call.startedAt != nil { debrief = DebriefTarget(id: id) }
        case "missed", "declined", "cancelled":
            phoneCallId = nil
        default:
            break // still ringing, on the line, or being scored
        }
    }

    func answer(callId: String, callerId: String, uuid: UUID) {
        let scenario = catalog?.scenarios.first { $0.callerId == callerId }
        let call = ActiveCall(
            id: callId,
            uuid: uuid,
            callerId: callerId,
            scenario: scenario,
            safeWord: me?.settings.safeWord ?? "",
            serverSpeech: me?.speech.server ?? false,
            api: api
        )
        call.onEnded = { [weak self, weak call] reason in
            guard let self, let call else { return }
            if reason == .hungUp || reason == .practiceReveal {
                CallManager.shared.requestEnd(uuid: call.uuid)
            } else {
                CallManager.shared.reportEnded(uuid: call.uuid)
            }
            // Show the debrief once the call screen closes.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self.activeCall = nil
                if call.connectedAt != nil && reason != .practiceReveal {
                    self.debrief = DebriefTarget(id: call.id)
                }
            }
        }
        activeCall = call
        // Load the profile and scenarios if the app was launched by the call itself.
        if me == nil || catalog == nil { Task { await refresh() } }
    }

    func declined(callId: String) {
        Task { try? await api.decline(callId) }
    }
}
