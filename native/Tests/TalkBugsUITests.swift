import XCTest

final class TalkBugsUITests: XCTestCase {
    @MainActor func testSpeakSendsAndSurvivesRelaunch() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "A spoken message from the iPhone simulator."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"] ?? "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].tap()
        XCTAssertTrue(app.staticTexts["A spoken message from the iPhone simulator."].waitForExistence(timeout: 20))
        XCTAssertEqual(app.textFields.count, 0)
        XCTAssertEqual(app.textViews.count, 0)
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["A spoken message from the iPhone simulator."].waitForExistence(timeout: 20))
    }
    @MainActor func testNewRoomAndVoiceShortcutHaveNoTypedInput() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "Message in the original room."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].tap()
        XCTAssertTrue(app.staticTexts["Message in the original room."].waitForExistence(timeout: 15))
        app.buttons["New room"].tap()
        app.buttons["confirm-new-room"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No messages yet"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Message in the original room."].exists)
        app.open(URL(string: "talk-bugs://talk")!)
        XCTAssertTrue(app.staticTexts["Message in the original room."].waitForExistence(timeout: 15))
        XCTAssertEqual(app.textFields.count, 0)
    }
}
