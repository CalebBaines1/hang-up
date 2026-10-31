import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var model: AppModel
    @State private var step = 0
    @State private var name = ""
    @State private var safeWord = "pineapple"
    @State private var consent = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label("Hang Up", systemImage: "phone.down.fill")
                    .font(.headline)
                    .foregroundStyle(Theme.green)
                if step == 0 { intro } else { setup }
            }
            .padding(24)
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("SCAM CALL PRACTICE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text("The best defense is hanging up.").font(.largeTitle.bold())
            Text("Hang Up rings your iPhone with realistic AI scam calls: a fake bank, a grandchild in trouble, a tax warrant. Then a coach shows you the tell you missed.")
                .foregroundStyle(.secondary)
            Card {
                Text("How it works").font(.headline)
                Text("1. Pick a safe word that ends any call instantly.")
                Text("2. Your phone rings like a real call, even on the lock screen.")
                Text("3. Hang up when you spot the scam, then get your debrief.")
            }
            Button { step = 1 } label: {
                Text("Get started").frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Set up").font(.largeTitle.bold())
            VStack(alignment: .leading, spacing: 6) {
                Text("Your first name").font(.subheadline.weight(.semibold))
                TextField("Name", text: $name)
                    .textContentType(.givenName)
                    .padding(12)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                Text("The AI caller uses it, like a real scammer would.").font(.footnote).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Safe word").font(.subheadline.weight(.semibold))
                TextField("Safe word", text: $safeWord)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                Text("Say it on any call to end it immediately, no score.").font(.footnote).foregroundStyle(.secondary)
            }
            Toggle(isOn: $consent) {
                Text("I understand Hang Up will ring me with AI practice calls that sound like real scams, and that nobody real is on the line.")
                    .font(.subheadline)
            }
            if let error {
                Text(error).foregroundStyle(Theme.red).font(.footnote)
            }
            Button {
                Task { await finish() }
            } label: {
                Group {
                    if busy { ProgressView() } else { Text("Start practicing") }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy || !consent || name.trimmingCharacters(in: .whitespaces).isEmpty || safeWord.count < 3)
        }
    }

    private func finish() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await model.register(name: name.trimmingCharacters(in: .whitespaces), safeWord: safeWord)
            _ = await Listener.requestPermission()
            await model.refresh()
        } catch {
            self.error = "Couldn't reach Hang Up: \(error.localizedDescription)"
        }
    }
}
