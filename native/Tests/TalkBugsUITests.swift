import XCTest

final class TalkBugsUITests: XCTestCase {
    @MainActor private func checkHistory(_ app: XCUIApplication, text: String) {
        XCTAssertFalse(app.staticTexts[text].exists, "Own words must not occupy the incoming view")
        app.buttons["History"].tap()
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 20))
        app.buttons["Done"].tap()
    }
    @MainActor func testHoldSendsOnReleaseAndSurvivesRelaunch() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "A spoken message from the iPhone simulator."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"] ?? "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].press(forDuration: 0.6)
        checkHistory(app, text: "A spoken message from the iPhone simulator.")
        XCTAssertEqual(app.textFields.count, 0)
        XCTAssertEqual(app.textViews.count, 0)
        app.terminate(); app.launch()
        checkHistory(app, text: "A spoken message from the iPhone simulator.")
    }
    @MainActor func testNewRoomAndShortcutRequireAHold() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "Message in the original room."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].press(forDuration: 0.6)
        checkHistory(app, text: "Message in the original room.")
        app.buttons["New room"].tap()
        app.buttons["confirm-new-room"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No one else here"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Message in the original room."].exists)
        // XCUIApplication.open may relaunch; keep the newly selected persisted room.
        app.launchEnvironment.removeValue(forKey: "TALK_BUGS_TEST_ROOM")
        app.open(URL(string: "talk-bugs://talk")!)
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["speak"].label, "Hold to talk")
        XCTAssertTrue(app.staticTexts["No one else here"].exists)
        app.buttons["speak"].press(forDuration: 0.6)
        checkHistory(app, text: "Message in the original room.")
        XCTAssertEqual(app.textFields.count, 0)
    }
    @MainActor func testTapDoesNotLatchRecordingAndReleaseOutsideSends() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "Released outside the microphone button."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = "http://127.0.0.1:5173"
        app.launch()
        let button = app.buttons["speak"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        button.tap()
        XCTAssertEqual(button.label, "Hold to talk")
        XCTAssertFalse(app.staticTexts["Released outside the microphone button."].exists)
        button.press(forDuration: 0.6, thenDragTo: app.navigationBars.firstMatch)
        checkHistory(app, text: "Released outside the microphone button.")
        XCTAssertEqual(button.label, "Hold to talk")
    }

    @MainActor private func send(room: String, token: String, id: String, text: String, revision: Int = 1, final: Bool = true) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:5173/api/rooms/\(room)/transcript")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["type": "transcript", "utteranceId": id, "text": text, "revision": revision, "final": final])
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }
    @MainActor func testIncomingSpeakersStayInPlaceAndHistoryIncludesOwnTurns() async throws {
        let room = UUID().uuidString.lowercased(), a = UUID().uuidString.lowercased(), b = UUID().uuidString.lowercased()
        let first = UUID().uuidString.lowercased(), second = UUID().uuidString.lowercased()
        try await send(room: room, token: a, id: first, text: "Which aisle?", final: false)
        try await send(room: room, token: b, id: second, text: "Near the fruit.", final: false)
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = room
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = "http://127.0.0.1:5173"
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "My own words stay in History."
        app.launch()
        XCTAssertTrue(app.staticTexts["Which aisle?"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Near the fruit."].exists)
        XCTAssertTrue(app.staticTexts["Near the fruit."].isHittable, "Both incoming speakers should fit on screen")
        let position = app.staticTexts["Near the fruit."].frame.minY
        let correction = "Which aisle are you in? I am looking near the vegetables and will come find you."
        try await send(room: room, token: a, id: first, text: correction, revision: 2, final: false)
        XCTAssertTrue(app.staticTexts[correction].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["Near the fruit."].frame.minY, position, accuracy: 1)
        app.buttons["speak"].press(forDuration: 0.6)
        checkHistory(app, text: "My own words stay in History.")
        XCTAssertTrue(app.staticTexts[correction].exists)
        try await send(room: room, token: a, id: first, text: correction, revision: 3)
        try await send(room: room, token: a, id: UUID().uuidString.lowercased(), text: "I can see you now.")
        XCTAssertTrue(app.staticTexts["I can see you now."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[correction].exists, "The previous turn remains available")
        XCTAssertFalse(app.staticTexts["My own words stay in History."].exists)
    }
}
