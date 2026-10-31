import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject private var calls = CallManager.shared
    @State private var s: Settings?
    @State private var server = ""
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    private let dayNames = ["S", "M", "T", "W", "T", "F", "S"]

    var body: some View {
        Form {
            if let binding = Binding($s) {
                Section("You") {
                    LabeledContent("Name") { TextField("Name", text: binding.displayName).multilineTextAlignment(.trailing) }
                    LabeledContent("Safe word") {
                        TextField("Safe word", text: binding.safeWord)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                Section {
                    Toggle("Surprise calls", isOn: binding.scheduleEnabled)
                    if binding.wrappedValue.scheduleEnabled {
                        Stepper("\(binding.wrappedValue.callsPerWeek) per week", value: binding.callsPerWeek, in: 1...3)
                        HStack {
                            ForEach(0..<7, id: \.self) { d in
                                let on = binding.wrappedValue.window.days.contains(d)
                                Button(dayNames[d]) {
                                    if on { binding.wrappedValue.window.days.removeAll { $0 == d } } else { binding.wrappedValue.window.days.append(d) }
                                }
                                .buttonStyle(.plain)
                                .frame(width: 34, height: 34)
                                .background(on ? Theme.green : Theme.card, in: Circle())
                                .foregroundStyle(on ? .black : .primary)
                            }
                        }
                        DatePicker("From", selection: time(binding.window.start), displayedComponents: .hourAndMinute)
                        DatePicker("Until", selection: time(binding.window.end), displayedComponents: .hourAndMinute)
                    }
                } header: {
                    Text("Surprise calls")
                } footer: {
                    Text(calls.voipToken == nil
                        ? "This build can't receive VoIP pushes yet, so surprise calls ring the next time you open the app."
                        : "Surprise calls ring through the normal iPhone call screen, even when the app is closed.")
                }
                Section {
                    Button(saving ? "Saving…" : "Save changes") { Task { await save() } }
                        .disabled(saving || binding.wrappedValue == model.me?.settings)
                    if let error { Text(error).foregroundStyle(Theme.red).font(.footnote) }
                }
            } else {
                ProgressView()
            }

            Section {
                TextField("Server URL", text: $server)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { model.serverURL = server }
            } header: {
                Text("Server")
            } footer: {
                Text("The Hang Up backend this app talks to. Changing it means setting up again.")
            }

            Section {
                Button("Delete my data", role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            s = model.me?.settings
            server = model.serverURL
        }
        .onChange(of: model.me?.settings) { _, new in if s == nil { s = new } }
        .confirmationDialog("Delete all your calls, scores and settings?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    try? await model.api.deleteMyData()
                    model.signOut()
                }
            }
        }
    }

    private func time(_ hhmm: Binding<String>) -> Binding<Date> {
        Binding {
            let p = hhmm.wrappedValue.split(separator: ":").compactMap { Int($0) }
            return Calendar.current.date(bySettingHour: p.first ?? 9, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
        } set: { d in
            let c = Calendar.current.dateComponents([.hour, .minute], from: d)
            hhmm.wrappedValue = String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
        }
    }

    private func save() async {
        guard let s else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            model.me = try await model.api.updateSettings([
                "displayName": s.displayName,
                "safeWord": s.safeWord,
                "timezone": TimeZone.current.identifier,
                "scheduleEnabled": s.scheduleEnabled,
                "callsPerWeek": s.callsPerWeek,
                "window": ["days": s.window.days.sorted(), "start": s.window.start, "end": s.window.end],
            ])
            self.s = model.me?.settings
        } catch {
            self.error = error.localizedDescription
        }
    }
}
