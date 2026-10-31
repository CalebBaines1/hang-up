import AVFoundation
import Speech

/// Turns the user's speech into text on the iPhone with Apple's recognizer.
/// An utterance ends when the words stop changing for a moment.
final class Listener {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Timer?
    private var partial = ""
    private var generation = 0
    var muted = false

    /// Words so far in the current utterance (main thread).
    var onPartial: ((String) -> Void)?
    /// A finished utterance (main thread).
    var onUtterance: ((String) -> Void)?
    /// Microphone level 0...1 (main thread).
    var onLevel: ((Float) -> Void)?

    static func requestPermission() async -> Bool {
        let speech = await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        let mic = await AVAudioApplication.requestRecordPermission()
        return speech && mic
    }

    func start() {
        restart()
    }

    func stop() {
        generation += 1
        silence?.invalidate()
        lock.lock()
        request?.endAudio()
        request = nil
        lock.unlock()
        task?.cancel()
        task = nil
    }

    /// Audio thread.
    func append(_ buffer: AVAudioPCMBuffer) {
        if muted { return }
        lock.lock()
        request?.append(buffer)
        lock.unlock()
        if let ch = buffer.floatChannelData?[0], buffer.frameLength > 0 {
            var sum: Float = 0
            for i in 0..<Int(buffer.frameLength) { sum += ch[i] * ch[i] }
            let rms = sqrt(sum / Float(buffer.frameLength))
            DispatchQueue.main.async { self.onLevel?(min(1, rms * 12)) }
        }
    }

    private func restart() {
        stop()
        partial = ""
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        if recognizer?.supportsOnDeviceRecognition == true { req.requiresOnDeviceRecognition = true }
        lock.lock()
        request = req
        lock.unlock()
        let gen = generation
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if text != self.partial {
                        self.partial = text
                        self.onPartial?(text)
                        self.armSilence()
                    }
                    if result.isFinal { return self.commit() }
                }
                // Recognition tasks time out after about a minute; start a fresh one.
                if error != nil {
                    if !self.partial.isEmpty { return self.commit() }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        if gen == self.generation { self.restart() }
                    }
                }
            }
        }
    }

    private func armSilence() {
        silence?.invalidate()
        silence = Timer.scheduledTimer(withTimeInterval: 0.9, repeats: false) { [weak self] _ in self?.commit() }
    }

    private func commit() {
        let text = partial.trimmingCharacters(in: .whitespaces)
        restart()
        if !text.isEmpty { onUtterance?(text) }
    }
}
