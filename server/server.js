// server/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

// ... (Mongoose connection and schemas are all good, no changes there) ...
await mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const strokeSchema = new mongoose.Schema(
  {
    id: String,
    owner: String,
    points: Array,
    color: String,
    size: Number,
    tool: String,
    stability: Number,
    brush: String,
    opacity: Number, // <--- ADD THIS LINE
  },
  { _id: false }
); // ... (roomSchema and RoomModel are good) ...
const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, unique: true },
    strokes: [strokeSchema],
  },
  { timestamps: true }
);

const RoomModel = mongoose.model("Room", roomSchema);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://art-app-frontend.onrender.com", // Your exact frontend URL
    methods: ["GET", "POST"],
  },
});
const genId = () =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const cursors = {};

io.on("connection", (socket) => {
  console.log("🟢 connected", socket.id);

  socket.on("join-room", async (roomId) => {
    // ... (no changes here) ...
    try {
      if (!roomId) return socket.emit("error-msg", { message: "Invalid room" });
      socket.join(roomId);
      let room = await RoomModel.findOne({ roomId }).lean();
      if (!room) {
        room = await RoomModel.create({ roomId, strokes: [] });
      }
      socket.emit("init", room.strokes || []);
      console.log(
        `→ ${socket.id} joined ${roomId} (strokes: ${
          room.strokes?.length || 0
        })`
      );
    } catch (err) {
      console.error("join-room err", err);
      socket.emit("error-msg", { message: "Failed joining room" });
    }
  });

  // ... after "join-room"

  socket.on("leave-room", (roomId) => {
    try {
      // Check how many people are in the room *before* this user leaves
      const clientsInRoom = io.sockets.adapter.rooms.get(roomId)?.size || 0;

      // If the count is 1, it means this socket is the last one.
      if (clientsInRoom === 1) {
        console.log(`🧹 User clicked Exit on ${roomId}. Clearing room.`);

        // This is the last user. Clear the database.
        // We wrap this in an async IIFE.
        (async () => {
          try {
            await RoomModel.findOneAndUpdate(
              { roomId },
              { strokes: [] }, // Set strokes to an empty array
              { new: true }
            );
          } catch (err) {
            console.error(`Failed to clear room ${roomId}:`, err);
          }
        })();
      }

      // We don't need to do anything else. The client will navigate,
      // which will trigger the 'disconnecting' event, but the
      // room will already be cleared.
    } catch (err) {
      console.error("leave-room err", err);
    }
  });

  // --- NEW: Live-streaming stroke start ---
  // ... (rest of your server code) ...

  // --- NEW: Live-streaming stroke start ---
  socket.on("start-stroke", ({ roomId, stroke }) => {
    try {
      // Just broadcast this to others, don't save
      socket.to(roomId).emit("live-stroke-start", stroke);
    } catch (err) {
      console.error("start-stroke err", err);
    }
  });

  // --- NEW: Live-streaming stroke points ---
  socket.on("continue-stroke", ({ roomId, id, point }) => {
    try {
      // Just broadcast this to others, don't save
      socket.to(roomId).emit("live-stroke-update", { id, point });
    } catch (err) {
      console.error("continue-stroke err", err);
    }
  });

  // "draw" is now the "end-stroke" event. This is the only one we save.
  socket.on("draw", async ({ roomId, line }) => {
    try {
      if (!roomId || !line)
        return socket.emit("error-msg", { message: "Invalid draw" });

      // We use the client-generated ID as the primary key
      const stroke = { ...line, owner: socket.id };

      const room = await RoomModel.findOneAndUpdate(
        { roomId },
        { $push: { strokes: stroke } },
        { new: true, upsert: true }
      );

      // Acknowledge the sender with the final stroke
      socket.emit("draw-ack", stroke);
      // Broadcast the final stroke to others
      socket.to(roomId).emit("draw", stroke);
    } catch (err) {
      console.error("draw err", err);
      socket.emit("error-msg", { message: "Draw failed" });
    }
  });

  // ... (undo, redo, clear are all good, no changes) ...
  socket.on("undo", async (roomId) => {
    try {
      const room = await RoomModel.findOne({ roomId });
      if (!room) return socket.emit("error-msg", { message: "Room not found" });
      for (let i = room.strokes.length - 1; i >= 0; i--) {
        if (room.strokes[i].owner === socket.id) {
          const removed = room.strokes.splice(i, 1)[0];
          await room.save();
          io.to(roomId).emit("remove-stroke", removed.id);
          socket.emit("undo-ack", removed);
          return;
        }
      }
      socket.emit("error-msg", { message: "Nothing to undo" });
    } catch (err) {
      console.error("undo err", err);
      socket.emit("error-msg", { message: "Undo failed" });
    }
  });

  socket.on("redo", async ({ roomId, stroke }) => {
    try {
      if (!roomId || !stroke)
        return socket.emit("error-msg", { message: "Invalid redo" });
      // Use the client-side ID from the redo stack
      const newStroke = { ...stroke, owner: socket.id };
      const room = await RoomModel.findOneAndUpdate(
        { roomId },
        { $push: { strokes: newStroke } },
        { new: true, upsert: true }
      );
      socket.emit("draw-ack", newStroke);
      socket.to(roomId).emit("draw", newStroke);
    } catch (err) {
      console.error("redo err", err);
      socket.emit("error-msg", { message: "Redo failed" });
    }
  });

  socket.on("clear", async (roomId) => {
    try {
      await RoomModel.findOneAndUpdate(
        { roomId },
        { strokes: [] },
        { new: true }
      );
      io.to(roomId).emit("clear");
    } catch (err) {
      console.error("clear err", err);
      socket.emit("error-msg", { message: "Clear failed" });
    }
  });

  socket.on("cursor-move", ({ roomId, cursor }) => {
    // ... (no changes here) ...
    try {
      if (!roomId) return;
      cursors[socket.id] = cursor;
      socket.to(roomId).emit("cursor-update", { id: socket.id, cursor });
    } catch (err) {
      console.error("cursor-move err", err);
    }
  });

  socket.on("disconnecting", () => {
    try {
      // socket.rooms is a Set that includes the socket's own ID
      // and all rooms it has joined.
      for (const roomId of socket.rooms) {
        // A socket is always in a "room" of its own ID by default
        // We must skip that room, we only care about our app's rooms.
        if (roomId === socket.id) continue;

        // Get the number of clients in this room
        // (io.sockets.adapter.rooms.get(roomId) returns a Set of socket IDs)
        const clientsInRoom = io.sockets.adapter.rooms.get(roomId)?.size || 0;

        // Since this "disconnecting" event fires *before* the socket
        // has actually left, a count of "1" means this is the last user.
        if (clientsInRoom === 1) {
          console.log(`🧹 Last user left ${roomId}. Clearing room.`);

          // This is the last user. Clear the database for this room.
          // We wrap the async call in an IIFE (Immediately-Invoked Function Expression)
          // because the 'disconnecting' handler itself isn't async.
          (async () => {
            try {
              await RoomModel.findOneAndUpdate(
                { roomId },
                { strokes: [] }, // Set strokes to an empty array
                { new: true }
              );
            } catch (err) {
              console.error(`Failed to clear room ${roomId}:`, err);
            }
          })();
        } else {
          // The room is NOT empty. Just notify the remaining users.
          socket.to(roomId).emit("cursor-remove", socket.id);
          socket.to(roomId).emit("live-stroke-end", socket.id);
        }
      }

      // Clean up the in-memory cursor data
      delete cursors[socket.id];
    } catch (err) {
      console.error("disconnecting err", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
