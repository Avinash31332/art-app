// client/src/Toolbar.jsx
import React from "react";

export default function Toolbar({
  roomId,
  tool,
  setTool,
  brush,
  setBrush,
  color,
  setColor,
  size,
  setSize,
  opacity,
  setOpacity,
  stability,
  setStability,
  canUndo,
  handleUndo,
  canRedo,
  handleRedo,
  handleClear,
  handleExit,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between bg-white shadow px-3 py-2 border-b z-20">
      {/* Left tools: Tool & Brush selection */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-gray-700 mr-2">Room: {roomId}</span>

        {/* --- Tool Selector (Brush vs Eraser) --- */}
        <div className="flex items-center rounded-md shadow-sm bg-gray-100 p-0.5">
          <button
            onClick={() => setTool("brush")}
            title="Brush"
            className={`px-3 py-1 rounded-md ${
              tool === "brush"
                ? "bg-blue-500 text-white shadow"
                : "text-gray-600"
            }`}
          >
            Brush
          </button>
          <button
            onClick={() => setTool("eraser")}
            title="Eraser"
            className={`px-3 py-1 rounded-md ${
              tool === "eraser"
                ? "bg-orange-500 text-white shadow"
                : "text-gray-600"
            }`}
          >
            Eraser
          </button>
        </div>

        {/* --- Brush Selector (Dropdown) --- */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Brush</label>
          <select
            value={brush}
            onChange={(e) => setBrush(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          >
            <option value="pen">Pen</option>
            <option value="highlighter">Highlighter</option>
            <option value="airbrush">Airbrush</option>
          </select>
        </div>

        {/* --- Brush Options --- */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Size</label>
          <input
            type="range"
            min="1"
            max="200"
            value={size} // <-- CHANGED
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-gray-500 w-10 text-right">
            {size}px
          </span>{" "}
          {/* <-- ADDED */}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Opacity</label>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.01"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-gray-500 w-8 text-right">
            {opacity.toFixed(2)}
          </span>{" "}
          {/* <-- ADDED */}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={tool === "eraser"}
            className={
              tool === "eraser" ? "opacity-50 pointer-events-none" : ""
            }
          />
        </div>
      </div>

      {/* Middle: Stability */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Stability</label>
        <input
          type="range"
          min="0"
          max="10"
          value={stability}
          onChange={(e) => setStability(Number(e.target.value))}
          className="w-32"
        />
        <div className="ml-2 text-xs text-gray-600 w-24">
          {stability === 0
            ? "Raw (0)"
            : stability === 10
            ? "Max (10)"
            : `Smooth: ${stability}`}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 mt-2 sm:mt-0">
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`px-3 py-1 rounded ${
            canUndo
              ? "bg-gray-200 hover:bg-gray-300"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          ↩ Undo
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`px-3 py-1 rounded ${
            canRedo
              ? "bg-gray-200 hover:bg-gray-300"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          ↪ Redo
        </button>
        <button
          onClick={handleClear}
          className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
        >
          Clear
        </button>
        <button
          onClick={handleExit}
          className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
