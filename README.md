# Monitask Backend Server

This is the backend mediator for the Monitask desktop activity monitor. It handles MongoDB integration, user authentication, and tracking data aggregation.

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and update with your MongoDB URI and JWT secret:

```bash
cp .env.example .env
```

Update `.env`:
```
MONGO_URI=mongodb+srv://youruser:yourpass@cluster.mongodb.net/dbname?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-key-change-in-production
PORT=3001
```

### 3. Start the Server
```bash
npm start
```

The server will run on `http://localhost:3001`

## API Endpoints

### Authentication

#### POST `/api/auth/signup`
Create a new user account.

**Request:**
```json
{
  "username": "string",
  "email": "string",
  "password": "string (min 6 chars)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "username": "string",
    "email": "string"
  }
}
```

#### POST `/api/auth/login`
Authenticate and get a JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "username": "string",
    "email": "string"
  }
}
```

#### GET `/api/auth/verify`
Verify a JWT token.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "string",
    "username": "string",
    "email": "string",
    "iat": number,
    "exp": number
  }
}
```

### Users

#### GET `/api/users`
Fetch all users.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "mongo-id",
      "username": "string",
      "email": "string",
      "createdAt": "iso-date"
    }
  ]
}
```

### Tracking

#### POST `/api/tracking`
Save tracking entries from the Electron app.

**Request:**
```json
{
  "entries": [
    {
      "app": "string",
      "title": "string",
      "duration": number (milliseconds),
      "userEmail": "string",
      "timestamp": "iso-date"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "inserted": number
}
```

#### GET `/api/tracking`
Fetch all tracking entries (latest first).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "mongo-id",
      "app": "string",
      "title": "string",
      "duration": number,
      "userEmail": "string",
      "timestamp": "iso-date",
      "createdAt": "iso-date"
    }
  ]
}
```

#### GET `/api/tracking/summary`
Get aggregated tracking statistics by user and application.

**Response:**
```json
{
  "success": true,
  "data": {
    "userSummary": [
      {
        "userEmail": "string",
        "totalDuration": number,
        "entries": number
      }
    ],
    "appSummary": [
      {
        "app": "string",
        "totalDuration": number,
        "entries": number
      }
    ]
  }
}
```

## Database Schema

### User
- `username`: String (unique, min 3 chars)
- `email`: String (unique, lowercase)
- `password`: String (hashed, min 6 chars)
- `createdAt`: Date (default: now)

### TrackingEntry
- `app`: String (required)
- `title`: String (required)
- `duration`: Number (milliseconds, min 0)
- `userEmail`: String (lowercase, default: "unknown")
- `timestamp`: Date (required)
- `createdAt`: Date (default: now)

## Running in Production

1. Set a strong `JWT_SECRET` in your environment
2. Use a production MongoDB cluster with authentication
3. Deploy using a process manager like PM2 or systemd
4. Set `NODE_ENV=production`
