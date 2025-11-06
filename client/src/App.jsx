import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function App() {
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  const handleJoin = () => {
    if (!roomId.trim()) return;
    navigate(`/room/${roomId.trim()}`);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <h1 className="text-4xl font-bold mb-6 text-gray-800">🎨 CollabDraw</h1>
      <input
        type="text"
        placeholder="Enter room name..."
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        className="border border-gray-300 px-4 py-2 rounded-lg mb-4 w-64 focus:ring-2 focus:ring-blue-400 outline-none"
      />
      <button
        onClick={handleJoin}
        className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition"
      >
        Join Room
      </button>
    </div>
  );
}
