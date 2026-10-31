import SwiftUI

enum Theme {
    static let green = Color(red: 0.20, green: 0.78, blue: 0.35)
    static let red = Color(red: 1.0, green: 0.23, blue: 0.19)
    static let card = Color.white.opacity(0.07)
}

func initials(_ name: String) -> String {
    let parts = name.split(separator: " ").prefix(2)
    let s = parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
    return s.isEmpty ? "?" : s
}

func formatDuration(_ seconds: TimeInterval) -> String {
    let s = max(0, Int(seconds))
    return String(format: "%d:%02d", s / 60, s % 60)
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct RoundButton: View {
    var systemImage: String
    var label: String
    var color: Color = .white.opacity(0.15)
    var on = false
    var size: CGFloat = 72
    var action: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(on ? .black : .white)
                    .frame(width: size, height: size)
                    .background(on ? .white : color, in: Circle())
            }
            .accessibilityLabel(label)
            Text(label).font(.footnote).foregroundStyle(.white.opacity(0.85))
        }
    }
}

struct ScoreRing: View {
    var score: Int
    var size: CGFloat = 120
    var color: Color { score >= 80 ? Theme.green : score >= 50 ? .orange : Theme.red }
    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.1), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(score) / 100)
                .stroke(color, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(score)").font(.system(size: size * 0.33, weight: .bold, design: .rounded))
        }
        .frame(width: size, height: size)
    }
}
