public struct AgentSessionOwnership: Sendable {
    private var authenticatedConnections: Set<Int32> = []
    private var wasClaimed = false
    private var sessionClosed = false

    public init() {}

    public mutating func registerConnection(_ connection: Int32, authenticated: Bool) -> Bool {
        guard authenticated, !sessionClosed else { return false }
        let inserted = authenticatedConnections.insert(connection).inserted
        guard inserted, !wasClaimed else { return false }
        wasClaimed = true
        return true
    }

    public mutating func disconnect(_ connection: Int32) -> Bool {
        guard authenticatedConnections.remove(connection) != nil else { return false }
        guard wasClaimed, authenticatedConnections.isEmpty else { return false }
        sessionClosed = true
        return true
    }
}

public func isAuthenticatedAgentSession(
    expectedToken: String?,
    requestToken: String?,
    authorizedPeer: Bool
) -> Bool {
    guard authorizedPeer else { return false }
    guard let expectedToken else { return true }
    return requestToken == expectedToken
}
