import AVFoundation
import SwiftUI

struct DebriefView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let callId: String
    @State private var detail: CallDetail?
    @State private var failed = false
    @State private var player: AVPlayer?
    @State private var speaker = AVSpeechSynthesizer()
    @State private var playing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let detail, let result = detail.result {
                    content(detail, result)
                } else if failed {
                    ContentUnavailableView("No debrief", systemImage: "exclamationmark.bubble", description: Text("The coach couldn't score this call."))
                } else {
                    VStack(spacing: 16) {
                        ProgressView()
                        Text("Your coach is reviewing the call…").foregroundStyle(.secondary)
                    }
                    .padding(.top, 120)
                }
            }
            .navigationTitle("Debrief")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
        .task { await load() }
        .onDisappear {
            player?.pause()
            speaker.stopSpeaking(at: .immediate)
        }
    }

    private func load() async {
        // The judge model scores the call after it ends; poll until the result lands.
        for _ in 0..<45 {
            if let d = try? await model.api.call(callId) {
                detail = d
                if d.result != nil { return }
                if !["active", "ended"].contains(d.summary.status) { break }
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        failed = detail?.result == nil
    }

    @ViewBuilder private func content(_ d: CallDetail, _ r: CallResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 20) {
                ScoreRing(score: r.score)
                VStack(alignment: .leading, spacing: 4) {
                    Text(d.summary.scenarioTitle).font(.title3.bold())
                    Text(r.debrief.scam).font(.subheadline).foregroundStyle(.secondary)
                    Button { toggleCoach(r.debrief.spoken) } label: {
                        Label(playing ? "Stop" : "Hear your coach", systemImage: playing ? "stop.fill" : "play.fill")
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
                }
            }
            if r.payloadWarning {
                Card {
                    Label("You shared something that looked like a real card number or code.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text("It was removed from the transcript. On a real call, that would have been the moment the scam worked.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            section("Biggest tell", r.debrief.biggestTell, "eye")
            if let before = r.debrief.beforePitch { section("What they were about to ask", before, "hand.raised") }
            section("What you did well", r.debrief.didWell, "hand.thumbsup")
            section("Next time", r.debrief.doDifferently, "arrow.uturn.right")
            section("Earliest moment to hang up", r.debrief.earliestMoment, "phone.down")
            Card {
                Text("Score").font(.headline)
                ForEach(r.signals.filter(\.hit)) { s in
                    HStack {
                        Text(s.label).font(.subheadline)
                        Spacer()
                        Text(s.points > 0 ? "+\(s.points)" : "\(s.points)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(s.points >= 0 ? Theme.green : Theme.red)
                    }
                }
            }
            if !d.transcript.isEmpty {
                Card {
                    Text("Transcript").font(.headline)
                    ForEach(Array(d.transcript.enumerated()), id: \.offset) { _, line in
                        (Text(line.role == "caller" ? "\(d.summary.callerId): " : "You: ").bold() + Text(line.text))
                            .font(.subheadline)
                    }
                }
            }
        }
        .padding(20)
    }

    private func section(_ title: String, _ body: String, _ icon: String) -> some View {
        Card {
            Label(title, systemImage: icon).font(.headline)
            Text(body).font(.subheadline)
        }
    }

    /// Plays the coach's voice from the server, or reads the debrief on-device if the server has no speech service.
    private func toggleCoach(_ spoken: String) {
        if playing {
            player?.pause()
            speaker.stopSpeaking(at: .immediate)
            playing = false
            return
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        playing = true
        if model.me?.speech.server == true {
            let p = AVPlayer(url: model.api.debriefAudioURL(callId))
            player = p
            p.play()
        } else {
            speaker.speak(AVSpeechUtterance(string: spoken))
        }
    }
}
