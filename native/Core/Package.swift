// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "TalkBugsCore", platforms: [.iOS(.v18), .watchOS(.v11), .macOS(.v15)], products: [.library(name: "TalkBugsCore", targets: ["TalkBugsCore"])], targets: [.target(name: "TalkBugsCore"), .testTarget(name: "TalkBugsCoreTests", dependencies: ["TalkBugsCore"])])
