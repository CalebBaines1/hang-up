import AVFoundation
import CallKit
import PushKit
import UIKit

/// Makes practice calls ring like real phone calls.
///
/// - CallKit shows the system incoming-call screen (full screen on the lock
///   screen, a banner when unlocked), plays the ringtone, and owns the call's
///   audio session, mute and hang-up buttons.
/// - PushKit receives VoIP pushes from the server, which wake the app even
///   when it is closed so scheduled and family calls ring on time.
@MainActor
final class CallManager: NSObject, ObservableObject {
    static let shared = CallManager()

    private let provider: CXProvider
    private let controller = CXCallController()
    private var registry: PKPushRegistry?
    /// CallKit UUID -> server call id, for calls ringing or in progress.
    private var calls: [UUID: (id: String, callerId: String)] = [:]
    private var ringTimers: [UUID: Timer] = [:]
    @Published private(set) var voipToken: String?

    weak var model: AppModel?

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        // Keep practice calls out of the Phone app's Recents.
        config.includesCallsInRecents = false
        if let icon = UIImage(systemName: "phone.down.fill")?.withRenderingMode(.alwaysTemplate) {
            config.iconTemplateImageData = icon.pngData()
        }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: .main)
    }

    func registerForVoIP() {
        let r = PKPushRegistry(queue: .main)
        r.delegate = self
        r.desiredPushTypes = [.voIP]
        registry = r
    }

    func isTracking(callId: String) -> Bool {
        calls.values.contains { $0.id == callId }
    }

    /// Shows the system incoming-call screen for a practice call.
    func reportIncoming(callId: String, callerId: String, completion: (() -> Void)? = nil) {
        if isTracking(callId: callId) {
            completion?()
            return
        }
        let uuid = UUID()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerId)
        update.localizedCallerName = callerId
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        calls[uuid] = (callId, callerId)
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    // Do Not Disturb or Focus filtering, or another call is in progress.
                    print("incoming call not shown:", error)
                    self.calls[uuid] = nil
                } else {
                    // Stop ringing after 45 s like a real unanswered call; the server marks it missed.
                    self.ringTimers[uuid] = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { _ in
                        Task { @MainActor in
                            guard self.calls[uuid] != nil, self.model?.activeCall?.uuid != uuid else { return }
                            self.provider.reportCall(with: uuid, endedAt: Date(), reason: .unanswered)
                            self.calls[uuid] = nil
                        }
                    }
                }
                completion?()
            }
        }
    }

    /// The user hung up in the app: tell CallKit so the system call UI goes away too.
    func requestEnd(uuid: UUID) {
        controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { error in
            if let error { print("end call request failed:", error) }
        }
    }

    /// The AI caller or the server ended the call.
    func reportEnded(uuid: UUID) {
        guard calls[uuid] != nil else { return }
        calls[uuid] = nil
        provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
    }
}

extension CallManager: CXProviderDelegate {
    nonisolated func providerDidReset(_ provider: CXProvider) {
        Task { @MainActor in
            self.model?.activeCall?.hangUp()
            self.calls.removeAll()
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        Task { @MainActor in
            self.ringTimers.removeValue(forKey: action.callUUID)?.invalidate()
            guard let call = self.calls[action.callUUID], let model = self.model else { return action.fail() }
            CallAudio.configureSession()
            model.answer(callId: call.id, callerId: call.callerId, uuid: action.callUUID)
            action.fulfill()
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            self.ringTimers.removeValue(forKey: action.callUUID)?.invalidate()
            if let active = self.model?.activeCall, active.uuid == action.callUUID {
                active.hangUp()
            } else if let call = self.calls[action.callUUID] {
                // Declined while ringing: counts as screening the call.
                self.model?.declined(callId: call.id)
            }
            self.calls[action.callUUID] = nil
            action.fulfill()
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        Task { @MainActor in
            self.model?.activeCall?.muted = action.isMuted
            action.fulfill()
        }
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        Task { @MainActor in self.model?.activeCall?.begin() }
    }

    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}

extension CallManager: PKPushRegistryDelegate {
    nonisolated func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        let token = credentials.token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            self.voipToken = token
            self.model?.registerVoip(token: token)
        }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        // iOS requires every VoIP push to report a call to CallKit right away,
        // or it stops delivering them to the app.
        let data = payload.dictionaryPayload
        let callId = data["callId"] as? String ?? UUID().uuidString
        let callerId = data["callerId"] as? String ?? "Unknown"
        // The registry delivers on the main queue, so report synchronously.
        MainActor.assumeIsolated {
            self.reportIncoming(callId: callId, callerId: callerId, completion: completion)
        }
    }
}
