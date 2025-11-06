// client/src/Canvas.jsx
import React from "react";

export default function Canvas({
  canvasRef,
  drawingCanvasRef,
  tool, // <-- ADDED
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  cursors,
  toolbarHeight,
  userId,
}) {
  return (
    <div className="flex-1 relative">
      {/* Bottom canvas for committed strokes */}
      <canvas ref={canvasRef} className="absolute top-0 left-0 bg-white" />
      {/* Top canvas for live drawing */}
      <canvas
        ref={drawingCanvasRef}
        className="absolute top-0 left-0 touch-none"
        // --- REAL-TIME ERASER FIX ---
        // This CSS makes the top canvas "erase" the bottom one
        // when the tool is set to 'eraser'.
        style={{
          mixBlendMode: tool === "eraser" ? "destination-out" : "normal",
        }}
        // -----------------------------
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />

      {/* Other users' cursors */}
      {Object.entries(cursors).map(([id, cursor]) => {
        if (id === userId || !cursor) return null;
        return (
          <div
            key={id}
            className="absolute pointer-events-none transition-all duration-75 ease-linear z-40"
            style={{
              left: cursor.x,
              top: cursor.y + toolbarHeight,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className="w-6 h-6 rounded-full border-2 border-white shadow-md"
              style={{ backgroundColor: cursor.color }}
            />
            <div className="absolute left-1/2 -translate-x-1/2 mt-1 text-xs bg-white px-1 rounded">
              {cursor.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
