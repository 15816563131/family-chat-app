---
title: Family Chat
emoji: 💬
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
license: apache-2.0
app_port: 7860
---

# Family Chat

A real-time family chat application with SSE-based messaging, AI assistant, and group chat support.

## Features

- Real-time messaging via SSE (Server-Sent Events)
- AI-powered assistant integration
- Group chat with typing indicators
- Voice messages support
- WebRTC voice/video calls
- Background message polling for mobile
- Smart power optimization

## Tech Stack

- **Backend**: Flask + SocketIO + SSE
- **Frontend**: Vanilla JavaScript
- **Database**: SQLite (default) / PostgreSQL
- **Real-time**: Server-Sent Events (SSE) with SocketIO fallback

## Deployment

This Space uses Docker for deployment. The application will be available on port 7860.

### Environment Variables

- `DATABASE_URL`: Database connection string
- `DATA_DIR`: Data storage directory
- `UPLOAD_FOLDER`: File upload directory
- `ENABLE_SSE`: Enable SSE transport (default: true)
