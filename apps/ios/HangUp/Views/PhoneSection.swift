import SwiftUI

/// Settings: verify a phone number by SMS code, then choose real phone calls over the app.
struct PhoneSection: View {
    @EnvironmentObject var model: AppModel
    @State private var phone = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if model.me?.phoneCalls == true, let s = model.me?.settings {
            Section {
                if let number = s.phoneNumber, s.phoneVerifiedAt != nil {
                    LabeledContent("Number", value: number)
                    Toggle("Ring my real phone", isOn: Binding(
                        get: { model.me?.settings.ringPhone == true },
                        set: { on in Task { await run { model.me = try await model.api.updateSettings(["ringPhone": on]) } } }
                    ))
                    Button("Remove number", role: .destructive) {
                        Task { await run { model.me = try await model.api.removePhone() } }
                    }
                } else if codeSent {
                    TextField("6-digit code", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    Button(busy ? "Checking…" : "Verify") {
                        Task {
                            await run {
                                model.me = try await model.api.confirmPhone(code: code)
                                codeSent = false
                                code = ""
                            }
                        }
                    }
                    .disabled(busy || code.count < 4)
                    Button("Use a different number") { codeSent = false }
                } else {
                    TextField("+1 555 123 4567", text: $phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                    Button(busy ? "Sending…" : "Text me a code") {
                        Task {
                            await run {
                                try await model.api.startPhoneVerification(phone)
                                codeSent = true
                            }
                        }
                    }
                    .disabled(busy || phone.filter(\.isNumber).count < 8)
                }
                if let error { Text(error).foregroundStyle(Theme.red).font(.footnote) }
            } header: {
                Text("Real phone calls")
            } footer: {
                Text(s.ringPhone == true
                    ? "Practice and surprise calls come in as normal phone calls from a regular number, with no Hang Up label. Hang up the phone to end one; your debrief is waiting when you open the app."
                    : "Get practice calls as real phone calls instead of through the app. We text a code first so calls only ever go to your own number.")
            }
        }
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() } catch { self.error = error.localizedDescription }
    }
}
