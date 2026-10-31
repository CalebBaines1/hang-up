import AVFoundation

/// On-device voice for the AI caller when the server has no speech service.
/// Sentences are rendered with AVSpeechSynthesizer.write into buffers and
/// played through CallAudio, so they go through the phone-line filter and the
/// echo canceller instead of straight to the speaker.
final class CallerVoice: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var queue: [(String, VoiceHint?)] = []
    private var busy = false
    private var generation = 0
    /// Receives rendered audio on the main thread.
    var onBuffer: ((AVAudioPCMBuffer) -> Void)?
    var rendering: Bool { busy || !queue.isEmpty }

    override init() {
        super.init()
        synth.delegate = self
        synth.usesApplicationAudioSession = true
    }

    func say(_ text: String, hint: VoiceHint?) {
        queue.append((text, hint))
        next()
    }

    func stop() {
        generation += 1
        queue.removeAll()
        synth.stopSpeaking(at: .immediate)
        busy = false
    }

    private func next() {
        guard !busy, !queue.isEmpty else { return }
        busy = true
        let (text, hint) = queue.removeFirst()
        let u = AVSpeechUtterance(string: text)
        u.voice = Self.voice(for: hint)
        u.pitchMultiplier = Float(min(2, max(0.5, hint?.pitch ?? 1)))
        u.rate = AVSpeechUtteranceDefaultSpeechRate * Float(min(1.3, max(0.8, hint?.rate ?? 1)))
        let gen = generation
        synth.write(u) { [weak self] buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer else { return }
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if pcm.frameLength == 0 { return self.done(gen) }
                self.onBuffer?(pcm)
            }
        }
    }

    private func done(_ gen: Int) {
        guard gen == generation, busy else { return }
        busy = false
        next()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let gen = generation
        DispatchQueue.main.async { self.done(gen) }
    }

    /// Picks the best installed English voice of the persona's gender.
    /// Premium and enhanced voices (Settings > Accessibility > Spoken Content) sound far more human.
    private static func voice(for hint: VoiceHint?) -> AVSpeechSynthesisVoice? {
        let want: AVSpeechSynthesisVoiceGender = hint?.gender == "male" ? .male : .female
        let english = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") && !$0.voiceTraits.contains(.isNoveltyVoice) }
        let ranked = english.sorted { a, b in
            func score(_ v: AVSpeechSynthesisVoice) -> Int {
                (v.gender == want ? 100 : 0) + v.quality.rawValue * 10 + (v.language == "en-US" ? 1 : 0)
            }
            return score(a) > score(b)
        }
        return ranked.first ?? AVSpeechSynthesisVoice(language: "en-US")
    }
}
