// ============================================================
// SimpleBuild Pro — WebSocket Service
// Real-time collaboration infrastructure
// Supports: live cursors, co-editing, notifications, build logs
// ============================================================

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { logger } from '../services/logger';
import { cache } from '../services/cache';

// ─── Types ───────────────────────────────────────────────────

export interface WebSocketMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  senderId?: string;
  roomId?: string;
}

export interface WebSocketRoom {
  id: string;
  type: 'project' | 'file' | 'build' | 'notification';
  participants: Set<string>;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ConnectionInfo {
  userId: string;
  connectionId: string;
  rooms: Set<string>;
  connectedAt: number;
  lastPingAt: number;
  metadata: {
    userAgent?: string;
    ip?: string;
    organizationId?: string;
  };
}

// ─── WebSocket Manager ───────────────────────────────────────

/**
 * In-memory WebSocket connection manager
 * In GKE with multiple pods, this would be backed by Redis pub/sub
 * for cross-pod message delivery
 */
class WebSocketManager {
  private rooms: Map<string, WebSocketRoom> = new Map();
  private connections: Map<string, ConnectionInfo> = new Map();
  private messageHandlers: Map<string, (msg: WebSocketMessage, conn: ConnectionInfo) => void> = new Map();

  constructor() {
    // Cleanup stale connections every 30s
    setInterval(() => this.cleanupStaleConnections(), 30000);
  }

  /**
   * Register a new connection
   */
  registerConnection(userId: string, connectionId: string, metadata?: Record<string, string>): ConnectionInfo {
    const conn: ConnectionInfo = {
      userId,
      connectionId,
      rooms: new Set(),
      connectedAt: Date.now(),
      lastPingAt: Date.now(),
      metadata: metadata || {},
    };
    this.connections.set(connectionId, conn);
    
    logger.info('WebSocket connection registered', { userId, connectionId });
    return conn;
  }

  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Leave all rooms
    for (const roomId of conn.rooms) {
      this.leaveRoom(connectionId, roomId);
    }
    
    this.connections.delete(connectionId);
    logger.info('WebSocket connection removed', { userId: conn.userId, connectionId });
  }

  /**
   * Join a room (e.g., project:uuid, file:uuid, build:uuid)
   */
  joinRoom(connectionId: string, roomId: string, roomType: WebSocketRoom['type'] = 'project'): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        type: roomType,
        participants: new Set(),
        createdAt: Date.now(),
      });
    }

    const room = this.rooms.get(roomId)!;
    room.participants.add(connectionId);
    conn.rooms.add(roomId);

    // Notify room participants
    this.broadcastToRoom(roomId, {
      type: 'user_joined',
      payload: { userId: conn.userId, roomId },
      timestamp: Date.now(),
    }, connectionId);

    logger.debug('User joined room', { userId: conn.userId, roomId });
  }

  /**
   * Leave a room
   */
  leaveRoom(connectionId: string, roomId: string): void {
    const conn = this.connections.get(connectionId);
    const room = this.rooms.get(roomId);
    
    if (conn) conn.rooms.delete(roomId);
    if (room) {
      room.participants.delete(connectionId);
      
      // Notify remaining participants
      this.broadcastToRoom(roomId, {
        type: 'user_left',
        payload: { userId: conn?.userId, roomId },
        timestamp: Date.now(),
      });

      // Cleanup empty rooms
      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /**
   * Broadcast message to all connections in a room
   */
  broadcastToRoom(roomId: string, message: WebSocketMessage, excludeConnectionId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const connId of room.participants) {
      if (connId === excludeConnectionId) continue;
      // In a real implementation, this would send via the WebSocket connection
      // For now, we queue to Redis pub/sub for cross-pod delivery
      this.queueMessage(connId, message);
    }
  }

  /**
   * Send message to a specific user (all their connections)
   */
  sendToUser(userId: string, message: WebSocketMessage): void {
    for (const [connId, conn] of this.connections) {
      if (conn.userId === userId) {
        this.queueMessage(connId, message);
      }
    }
  }

  /**
   * Queue a message for delivery (Redis pub/sub in production)
   */
  private async queueMessage(connectionId: string, message: WebSocketMessage): Promise<void> {
    // In production with multiple pods:
    // await redis.publish(`ws:conn:${connectionId}`, JSON.stringify(message));
    
    // For single-pod: direct delivery would happen here
    // The actual WebSocket send is handled by the upgrade handler
    const queueKey = `ws:queue:${connectionId}`;
    await cache.set(queueKey, JSON.stringify(message), 30); // 30s TTL
  }

  /**
   * Register a message type handler
   */
  onMessage(type: string, handler: (msg: WebSocketMessage, conn: ConnectionInfo) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Handle incoming message
   */
  handleMessage(connectionId: string, message: WebSocketMessage): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.lastPingAt = Date.now();

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message, conn);
    } else {
      logger.warn('Unknown WebSocket message type', { type: message.type });
    }
  }

  /**
   * Cleanup stale connections (no ping in 60s)
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 60 seconds

    for (const [connId, conn] of this.connections) {
      if (now - conn.lastPingAt > staleThreshold) {
        logger.warn('Removing stale WebSocket connection', { 
          userId: conn.userId, 
          connectionId: connId,
          lastPing: new Date(conn.lastPingAt).toISOString(),
        });
        this.removeConnection(connId);
      }
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): Record<string, number> {
    return {
      totalConnections: this.connections.size,
      totalRooms: this.rooms.size,
      uniqueUsers: new Set(Array.from(this.connections.values()).map(c => c.userId)).size,
    };
  }

  /**
   * Get room participants
   */
  getRoomParticipants(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    
    return Array.from(room.participants)
      .map(connId => this.connections.get(connId)?.userId)
      .filter(Boolean) as string[];
  }
}

// Singleton instance
export const wsManager = new WebSocketManager();

// ─── WebSocket Routes (REST API for WebSocket state) ─────────

const app = new Hono();

// Health check for WebSocket service
app.get('/ws/health', (c) => {
  const stats = wsManager.getStats();
  return c.json({
    status: 'healthy',
    service: 'websocket',
    stats,
    timestamp: new Date().toISOString(),
  });
});

// Get room participants
app.get('/ws/rooms/:roomId/participants', (c) => {
  const roomId = c.req.param('roomId');
  const participants = wsManager.getRoomParticipants(roomId);
  return c.json({ roomId, participants, count: participants.length });
});

// Get connection stats
app.get('/ws/stats', (c) => {
  return c.json(wsManager.getStats());
});

export { app as websocketRoutes };

// ─── Message Type Handlers ───────────────────────────────────

// Register standard message handlers
wsManager.onMessage('ping', (msg, conn) => {
  // Client keepalive
  wsManager.sendToUser(conn.userId, {
    type: 'pong',
    payload: {},
    timestamp: Date.now(),
  });
});

wsManager.onMessage('cursor_move', (msg, conn) => {
  // Broadcast cursor position to room participants
  if (msg.roomId) {
    wsManager.broadcastToRoom(msg.roomId, {
      type: 'cursor_update',
      payload: {
        userId: conn.userId,
        ...msg.payload,
      },
      timestamp: Date.now(),
      senderId: conn.userId,
    }, conn.connectionId);
  }
});

wsManager.onMessage('file_change', (msg, conn) => {
  // Broadcast file edit operations (OT/CRDT)
  if (msg.roomId) {
    wsManager.broadcastToRoom(msg.roomId, {
      type: 'file_change',
      payload: {
        userId: conn.userId,
        operation: msg.payload.operation,
        position: msg.payload.position,
        content: msg.payload.content,
      },
      timestamp: Date.now(),
      senderId: conn.userId,
    }, conn.connectionId);
  }
});

wsManager.onMessage('build_subscribe', (msg, conn) => {
  // Subscribe to build log stream
  const buildId = msg.payload.buildId as string;
  if (buildId) {
    wsManager.joinRoom(conn.connectionId, `build:${buildId}`, 'build');
  }
});

wsManager.onMessage('notification_ack', (msg, conn) => {
  // Acknowledge notification received
  logger.debug('Notification acknowledged', {
    userId: conn.userId,
    notificationId: msg.payload.notificationId,
  });
});

// ─── Cloud Run WebSocket Configuration Notes ─────────────────
/*
 * Cloud Run supports WebSocket connections with these constraints:
 * 
 * 1. Request timeout: Up to 3600s (1 hour) for streaming connections
 *    Set via: --timeout=3600 on Cloud Run deployment
 * 
 * 2. Session affinity: Required for WebSocket (sticky sessions)
 *    Set via: --session-affinity on Cloud Run deployment
 *    Or via BackendService sessionAffinity=GENERATED_COOKIE
 * 
 * 3. Connection limits: 1000 concurrent connections per instance
 *    Scale via: max-instances and concurrency settings
 * 
 * 4. Health checks: Use HTTP health endpoint (not WebSocket)
 *    Cloud Run uses HTTP GET for liveness/readiness
 * 
 * Deployment command for WebSocket-enabled Cloud Run:
 * 
 * gcloud run deploy simplebuildpro-ws \
 *   --image=us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:phase1 \
 *   --region=us-central1 \
 *   --set-env-vars=WS_MODE=true,PORT=8081 \
 *   --timeout=3600 \
 *   --session-affinity \
 *   --min-instances=1 \
 *   --max-instances=10 \
 *   --concurrency=1000 \
 *   --memory=512Mi \
 *   --cpu=1 \
 *   --port=8081 \
 *   --vpc-connector=sbpro-vpc-connector \
 *   --ingress=internal-and-cloud-load-balancing \
 *   --no-allow-unauthenticated
 * 
 * Load Balancer configuration:
 * - Create a separate NEG for the WebSocket service
 * - Set backend timeout to 3600s
 * - Enable session affinity (GENERATED_COOKIE)
 * - Route ws.simplebuildpro.com → WebSocket NEG
 */
