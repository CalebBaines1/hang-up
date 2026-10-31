import AVFoundation
import Foundation

/// One answered practice call: the WebSocket to the AI caller plus the audio.
@MainActor
final class ActiveCall: ObservableObject, Identifiable {
    struct Caption: Identifiable, Equatable {
        enum Role { case caller, user }
        let id: String
        let role: Role
        var text: String
    }

    let id: String
    let uuid: UUID
    @Published var callerId: String
    @Published var captions: [Caption] = []
    @Published var connectedAt: Date?
    @Published var error: String?
    @Published var level: Float = 0
    @Published var hearing = ""
    @Published var safeWord: String
    @Published var muted = false {
        didSet { listener.muted = muted }
    }
    @Published private(set) var ended: EndReason?

    /// Called once when the call is over, for whatever reason.
    var onEnded: ((EndReason) -> Void)?

    private let api: HangUpAPI
    private let scenario: Scenario?
    private let serverSpeech: Bool
    private var socket: CallSocket?
    private let audio = CallAudio()
    private let voice = CallerVoice()
    private let listener = Listener()
    private var mode = "browser"
    private var callerLine = ""
    private var callerTurn = -1
    private var pendingEnd: EndReason?
    private var started = false

    init(id: String, uuid: UUID, callerId: String, scenario: Scenario?, safeWord: String, serverSpeech: Bool, api: HangUpAPI) {
        self.id = id
        self.uuid = uuid
        self.callerId = callerId
        self.scenario = scenario
        self.safeWord = safeWord
        self.serverSpeech = serverSpeech
        self.api = api
    }

    private var callerSpeaking: Bool { audio.playing || voice.rendering }

    /// CallKit has activated the audio session: start the audio and dial the AI caller.
    func begin() {
        guard !started, ended == nil else { return }
        started = true
        // The caller's voice: the server's Kokoro voice if it has a speech service, else on-device.
        // The user's voice is always recognised on the iPhone and sent as text.
        let wanted = serverSpeech ? "server" : "browser"
        do {
            try audio.start(ambience: scenario?.ambience ?? "quiet", phoneFilter: wanted == "browser")
        } catch {
            self.error = "The call audio couldn't start: \(error.localizedDescription)"
        }
        audio.onMicBuffer = { [listener] buf in listener.append(buf) }
        audio.onIdle = { [weak self] in self?.callerIdle() }
        voice.onBuffer = { [weak self] buf in self?.audio.schedule(buf) }
        listener.onLevel = { [weak self] l in self?.level = l }
        listener.onPartial = { [weak self] text in self?.heard(partial: text) }
        listener.onUtterance = { [weak self] text in self?.heard(utterance: text) }

        let s = CallSocket(url: api.sessionURL(id))
        socket = s
        s.onMessage = { [weak self] m in self?.handle(m) }
        s.onClose = { [weak self] in
            guard let self, self.ended == nil else { return }
            if self.connectedAt == nil { self.error = "The call couldn't connect. Check your connection and try again." }
            self.finish(.disconnected)
        }
        s.connect(speech: wanted)
    }

    private func handle(_ m: ServerMessage) {
        switch m.type {
        case "ready":
            mode = m.speech ?? "browser"
            if let w = m.safeWord { safeWord = w }
            connectedAt = Date()
            listener.start()
        case "caller_audio":
            if let wav = m.wav { audio.scheduleWav(base64: wav) }
        case "caller_say":
            if let text = m.text {
                if m.turn != callerTurn {
                    callerTurn = m.turn ?? -1
                    callerLine = ""
                }
                callerLine += " " + text
                voice.say(text, hint: m.voiceHint)
            }
        case "caller_text":
            guard let turn = m.turn, let text = m.text else { return }
            let key = "c\(turn)"
            if let i = captions.firstIndex(where: { $0.id == key }) {
                captions[i].text = text
            } else {
                captions.append(Caption(id: key, role: .caller, text: text))
            }
            if mode == "server" { callerLine = text }
        case "caller_turn_end":
            break
        case "user_text":
            if let text = m.text { captions.append(Caption(id: "u\(captions.count)-\(Date().timeIntervalSince1970)", role: .user, text: text)) }
        case "error":
            error = m.message
        case "ended":
            let reason = m.reason ?? .disconnected
            if m.afterPlayback == true && callerSpeaking {
                // Let the caller's last line finish, then hang up.
                pendingEnd = reason
                DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.finish(reason) }
            } else {
                finish(reason)
            }
        default:
            break
        }
    }

    private func callerIdle() {
        guard !voice.rendering else { return }
        if let reason = pendingEnd { finish(reason) }
    }

    private func heard(partial text: String) {
        hearing = text
        // Barge-in: the user is talking over the caller. The echo canceller removes most of the
        // caller's voice from the mic; also ignore words that just repeat what the caller is saying.
        guard callerSpeaking, pendingEnd == nil else { return }
        let words = text.split(separator: " ")
        guard words.count >= 2, Self.overlap(text, callerLine) < 0.5 else { return }
        voice.stop()
        audio.interrupt()
        socket?.send(["type": "barge_in"])
    }

    private func heard(utterance text: String) {
        hearing = ""
        guard ended == nil, connectedAt != nil else { return }
        if callerSpeaking && Self.overlap(text, callerLine) >= 0.5 { return } // our own echo
        socket?.send(["type": "user_text", "text": text])
    }

    /// The user hung up (in the app or on the CallKit screen).
    func hangUp() {
        guard ended == nil else { return }
        socket?.send(["type": "hangup"])
        finish(.hungUp)
    }

    func revealPractice() {
        guard ended == nil else { return }
        socket?.send(["type": "practice_reveal"])
        finish(.practiceReveal)
    }

    private func finish(_ reason: EndReason) {
        guard ended == nil else { return }
        ended = reason
        listener.stop()
        voice.stop()
        audio.stop()
        let s = socket
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { s?.close() }
        onEnded?(reason)
    }

    /// Fraction of words in `a` that also appear in `b`.
    static func overlap(_ a: String, _ b: String) -> Double {
        func words(_ s: String) -> [String] {
            s.lowercased().split { !$0.isLetter && $0 != "'" }.map(String.init)
        }
        let wa = words(a)
        guard !wa.isEmpty else { return 0 }
        let wb = Set(words(b))
        return Double(wa.filter { wb.contains($0) }.count) / Double(wa.count)
    }
}
