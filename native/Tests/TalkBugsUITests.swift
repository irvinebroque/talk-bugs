import XCTest

final class TalkBugsUITests: XCTestCase {
    @MainActor func testHoldSendsOnReleaseAndSurvivesRelaunch() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "A spoken message from the iPhone simulator."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"] ?? "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].press(forDuration: 0.6)
        XCTAssertTrue(app.staticTexts["A spoken message from the iPhone simulator."].waitForExistence(timeout: 20))
        XCTAssertEqual(app.textFields.count, 0)
        XCTAssertEqual(app.textViews.count, 0)
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["A spoken message from the iPhone simulator."].waitForExistence(timeout: 20))
    }
    @MainActor func testNewRoomAndShortcutRequireAHold() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TALK_BUGS_TEST_ROOM"] = UUID().uuidString
        app.launchEnvironment["TALK_BUGS_TEST_TRANSCRIPT"] = "Message in the original room."
        app.launchEnvironment["TALK_BUGS_TEST_SERVER"] = "http://127.0.0.1:5173"
        app.launch()
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        app.buttons["speak"].press(forDuration: 0.6)
        XCTAssertTrue(app.staticTexts["Message in the original room."].waitForExistence(timeout: 15))
        app.buttons["New room"].tap()
        app.buttons["confirm-new-room"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No messages yet"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Message in the original room."].exists)
        // XCUIApplication.open may relaunch; keep the newly selected persisted room.
        app.launchEnvironment.removeValue(forKey: "TALK_BUGS_TEST_ROOM")
        app.open(URL(string: "talk-bugs://talk")!)
        XCTAssertTrue(app.buttons["speak"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["speak"].label, "Hold to talk")
        XCTAssertTrue(app.staticTexts["No messages yet"].exists)
        app.buttons["speak"].press(forDuration: 0.6)
        XCTAssertTrue(app.staticTexts["Message in the original room."].waitForExistence(timeout: 15))
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
        XCTAssertTrue(app.staticTexts["Released outside the microphone button."].waitForExistence(timeout: 15))
        XCTAssertEqual(button.label, "Hold to talk")
    }
}
