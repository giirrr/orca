import OrcaComputerUseMacOSCore
import XCTest

final class AgentSessionOwnershipTests: XCTestCase {
    func testUnclaimedDisconnectDoesNotTerminateAgent() {
        var ownership = AgentSessionOwnership()

        XCTAssertFalse(ownership.disconnect(12))
    }

    func testUnauthenticatedConnectionCannotClaimOrRetainAgent() {
        var ownership = AgentSessionOwnership()

        XCTAssertFalse(ownership.registerConnection(12, authenticated: false))
        XCTAssertFalse(ownership.disconnect(12))
    }

    func testLastAuthenticatedDisconnectTerminatesAgent() {
        var ownership = AgentSessionOwnership()

        XCTAssertTrue(ownership.registerConnection(12, authenticated: true))
        XCTAssertTrue(ownership.disconnect(12))
    }

    func testAgentWaitsForEveryAuthenticatedConnectionToClose() {
        var ownership = AgentSessionOwnership()

        XCTAssertTrue(ownership.registerConnection(12, authenticated: true))
        XCTAssertFalse(ownership.registerConnection(13, authenticated: true))
        XCTAssertFalse(ownership.disconnect(12))
        XCTAssertTrue(ownership.disconnect(13))
    }

    func testDuplicateRegistrationDoesNotRetainAgent() {
        var ownership = AgentSessionOwnership()

        XCTAssertTrue(ownership.registerConnection(12, authenticated: true))
        XCTAssertFalse(ownership.registerConnection(12, authenticated: true))
        XCTAssertTrue(ownership.disconnect(12))
    }

    func testClosedSessionRejectsNewConnections() {
        var ownership = AgentSessionOwnership()

        XCTAssertTrue(ownership.registerConnection(12, authenticated: true))
        XCTAssertTrue(ownership.disconnect(12))
        XCTAssertFalse(ownership.registerConnection(13, authenticated: true))
        XCTAssertFalse(ownership.disconnect(13))
    }

    func testTokenlessSessionStillRequiresAuthorizedPeer() {
        XCTAssertFalse(isAuthenticatedAgentSession(
            expectedToken: nil,
            requestToken: nil,
            authorizedPeer: false
        ))
        XCTAssertTrue(isAuthenticatedAgentSession(
            expectedToken: nil,
            requestToken: nil,
            authorizedPeer: true
        ))
    }

    func testTokenSessionRequiresAuthorizedPeerAndMatchingToken() {
        XCTAssertFalse(isAuthenticatedAgentSession(
            expectedToken: "expected",
            requestToken: "expected",
            authorizedPeer: false
        ))
        XCTAssertFalse(isAuthenticatedAgentSession(
            expectedToken: "expected",
            requestToken: "wrong",
            authorizedPeer: true
        ))
        XCTAssertTrue(isAuthenticatedAgentSession(
            expectedToken: "expected",
            requestToken: "expected",
            authorizedPeer: true
        ))
    }
}
