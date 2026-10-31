import SwiftUI

/// The in-app call screen. When the phone is locked, iOS shows its own CallKit
/// call screen instead; tapping the app button there opens this one.
struct InCallView: View {
    @ObservedObject var call: ActiveCall
    @State private var showCaptions = true
    @State private var confirmReveal = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(white: 0.16), .black], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            VStack(spacing: 0) {
                Button { confirmReveal = true } label: {
                    Text("THIS IS PRACTICE · safe word “\(call.safeWord)”")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(.white.opacity(0.12), in: Capsule())
                }
                .foregroundStyle(.white.opacity(0.8))
                .padding(.top, 8)

                VStack(spacing: 8) {
                    Text(initials(call.callerId))
                        .font(.system(size: 30, weight: .medium))
                        .frame(width: 80, height: 80)
                        .background(Color.gray.opacity(0.5), in: Circle())
                    Text(call.callerId).font(.system(size: 30, weight: .regular))
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(call.connectedAt.map { formatDuration(ctx.date.timeIntervalSince($0)) } ?? "Connecting…")
                            .font(.title3).foregroundStyle(.secondary).monospacedDigit()
                    }
                    Capsule().fill(.white.opacity(0.1)).frame(width: 80, height: 4)
                        .overlay(alignment: .leading) {
                            Capsule().fill(Theme.green).frame(width: 80 * CGFloat(call.level), height: 4)
                        }
                }
                .padding(.top, 36)

                if let error = call.error {
                    Text(error).font(.footnote).foregroundStyle(Theme.red).padding()
                }

                captions.opacity(showCaptions ? 1 : 0)

                HStack(spacing: 36) {
                    RoundButton(systemImage: call.muted ? "mic.slash.fill" : "mic.fill", label: call.muted ? "Unmute" : "Mute", on: call.muted) {
                        call.muted.toggle()
                    }
                    RoundButton(systemImage: "phone.down.fill", label: "Hang up", color: Theme.red) {
                        call.hangUp()
                    }
                    RoundButton(systemImage: "captions.bubble.fill", label: "Captions", on: showCaptions) {
                        showCaptions.toggle()
                    }
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16)
        }
        .confirmationDialog("This call is an AI simulation", isPresented: $confirmReveal, titleVisibility: .visible) {
            Button("End practice call", role: .destructive) { call.revealPractice() }
            Button("Keep practicing", role: .cancel) {}
        } message: {
            Text("Nobody real is on the line. End the call now with no score, or keep practicing. Saying “\(call.safeWord)” does the same.")
        }
    }

    private var captions: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(call.captions) { c in
                        Text(c.text)
                            .padding(10)
                            .background(c.role == .caller ? Color.white.opacity(0.1) : Theme.green.opacity(0.25), in: RoundedRectangle(cornerRadius: 14))
                            .frame(maxWidth: .infinity, alignment: c.role == .caller ? .leading : .trailing)
                            .id(c.id)
                    }
                    if !call.hearing.isEmpty {
                        Text(call.hearing).italic().foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .id("hearing")
                    }
                }
                .padding(.vertical, 16)
            }
            .onChange(of: call.captions) { _, caps in
                withAnimation { proxy.scrollTo(caps.last?.id, anchor: .bottom) }
            }
        }
    }
}
