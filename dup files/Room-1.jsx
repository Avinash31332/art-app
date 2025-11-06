// client/src/Room.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://localhost:5000");

// --- Helpers ---
const randomColor = () => `hsl(${Math.random() * 360}, 80%, 60%)`;
const randomName = () => "User" + Math.floor(Math.random() * 1000);
const genClientId = () =>
  `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(
    36
  )}`;
const lerp = (a, b, t) => a + (b - a) * t;

/* --- Catmull-Rom -> Bezier --- */
function catmullRom2bezier(points, tension = 0.5) {
  const beziers = [];
  if (!points || points.length < 2) return beziers;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const t = tension;
    const cp1x = p1.x + ((p2.x - p0.x) * t) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * t) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * t) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * t) / 6;
    beziers.push({ cp1x, cp1y, cp2x, cp2y, x: p2.x, y: p2.y });
  }
  return beziers;
}

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // --- Refs ---
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const drawingCtxRef = useRef(null);
  const toolbarRef = useRef(null);
  const user = useRef({ name: randomName(), color: randomColor(), id: null });

  // Refs for state
  const strokesRef = useRef([]); // All committed strokes
  const redoStackRef = useRef([]);
  const currentStrokeRef = useRef(null); // Our *own* live stroke
  const liveStrokesRef = useRef(new Map()); // *Other users'* live strokes
  const stablePointRef = useRef(null); // For input smoothing
  const pointerRef = useRef({ x: 0, y: 0, visible: false }); // For eraser
  const globalPointerUpHandlerRef = useRef(null); // For global 'up' event

  // --- React State ---
  const [toolbarHeight, setToolbarHeight] = useState(80);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState("brush");
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(12);
  const [stability, setStability] = useState(5);
  const [cursors, setCursors] = useState({});
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [message, setMessage] = useState(null);

  // --- Functions ---

  const showMessage = (text, type = "info", ms = 3500) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), ms);
  };

  const updateUndoRedoState = () => {
    const myId = user.current.id;
    // Guard against null ID during initial load
    if (!myId) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const hasOwn = strokesRef.current.some((s) => s.owner === myId);
    setCanUndo(Boolean(hasOwn));
    setCanRedo(Boolean(redoStackRef.current.length));
  };

  const drawSmoothStroke = (
    points,
    ctx,
    strokeColor,
    strokeSize,
    strokeStability,
    strokeTool
  ) => {
    if (!ctx || !points || points.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeSize;
    ctx.strokeStyle = strokeTool === "eraser" ? "#ffffff" : strokeColor;
    ctx.fillStyle = strokeTool === "eraser" ? "#ffffff" : strokeColor;

    if (points.length === 1) {
      const p = points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, strokeSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.closePath();
      ctx.restore();
      return;
    }
    const t = Math.max(0, Math.min((strokeStability || 0) / 10, 1)) * 0.9;
    const beziers = catmullRom2bezier(points, t);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < beziers.length; i++) {
      const b = beziers[i];
      ctx.bezierCurveTo(b.cp1x, b.cp1y, b.cp2x, b.cp2y, b.x, b.y);
    }
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  };

  // Redraws the main (bottom) canvas with committed strokes
  const redrawAll = (strokes) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      drawSmoothStroke(
        s.points || [],
        ctx,
        s.color,
        s.size,
        s.stability,
        s.tool
      );
    }
  };

  const drawEraserOverlay = (ctx, x, y, sizePx) => {
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.arc(x, y, sizePx / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  // Redraws the top (drawing) canvas with all live data
  const redrawTopCanvas = () => {
    const ctx = drawingCtxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw other users' live strokes
    liveStrokesRef.current.forEach((stroke) => {
      drawSmoothStroke(
        stroke.points,
        ctx,
        stroke.color,
        stroke.size,
        stroke.stability,
        stroke.tool
      );
    });

    // Draw our own live stroke
    if (currentStrokeRef.current) {
      const s = currentStrokeRef.current;
      drawSmoothStroke(s.points, ctx, s.color, s.size, s.stability, s.tool);
    }

    // Draw eraser overlay
    if (tool === "eraser" && pointerRef.current.visible) {
      drawEraserOverlay(ctx, pointerRef.current.x, pointerRef.current.y, size);
    }
  };

  /* ------------------ Socket + listeners ------------------ */
  // This single useEffect now handles *all* socket logic.
  useEffect(() => {
    // --- 1. Define all our listeners ---

    const onConnect = () => {
      console.log("Socket connected:", socket.id);
      user.current.id = socket.id;
      // NOW that we are connected and have an ID, join the room.
      if (roomId) {
        socket.emit("join-room", roomId);
      }
    };

    const onError = (err) => {
      showMessage(err?.message || "Server error", "error");
    };

    const onInit = (lines) => {
      strokesRef.current = lines.slice() || [];
      redoStackRef.current = [];
      liveStrokesRef.current.clear();
      redrawAll(strokesRef.current);
      redrawTopCanvas();
      updateUndoRedoState(); // This is now safe
    };

    const onLiveStrokeStart = (stroke) => {
      liveStrokesRef.current.set(stroke.id, stroke);
      redrawTopCanvas();
    };

    const onLiveStrokeUpdate = ({ id, point }) => {
      const stroke = liveStrokesRef.current.get(id);
      if (stroke) {
        stroke.points.push(point);
        redrawTopCanvas();
      }
    };

    const onLiveStrokeEnd = (ownerId) => {
      let strokeToRemove = null;
      for (const [strokeId, stroke] of liveStrokesRef.current.entries()) {
        if (stroke.owner === ownerId) {
          strokeToRemove = strokeId;
          break;
        }
      }
      if (strokeToRemove) {
        liveStrokesRef.current.delete(strokeToRemove);
        redrawTopCanvas();
      }
    };

    const onDraw = (stroke) => {
      liveStrokesRef.current.delete(stroke.id);
      strokesRef.current.push(stroke);
      redrawAll(strokesRef.current);
      redrawTopCanvas();
      updateUndoRedoState();
    };

    const onDrawAck = (stroke) => {
      strokesRef.current.push(stroke);
      redoStackRef.current = [];
      redrawAll(strokesRef.current);
      redrawTopCanvas();
      updateUndoRedoState();
    };

    const onRemoveStroke = (id) => {
      const idx = strokesRef.current.findIndex((s) => s.id === id);
      if (idx >= 0) strokesRef.current.splice(idx, 1);
      redrawAll(strokesRef.current);
      updateUndoRedoState();
    };

    const onUndoAck = (removedStroke) => {
      redoStackRef.current.push(removedStroke);
      updateUndoRedoState();
      showMessage("Undo successful", "info", 1500);
    };

    const onClear = () => {
      strokesRef.current = [];
      redoStackRef.current = [];
      ctxRef.current?.clearRect(
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );
      drawingCtxRef.current?.clearRect(
        0,
        0,
        drawingCanvasRef.current.width,
        drawingCanvasRef.current.height
      );
      liveStrokesRef.current.clear();
      updateUndoRedoState();
      showMessage("Canvas cleared", "info", 1200);
    };

    const onCursorUpdate = ({ id, cursor }) => {
      setCursors((prev) => ({ ...prev, [id]: cursor }));
    };

    const onCursorRemove = (id) => {
      setCursors((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    };

    // --- 2. Register all listeners ---

    // Room-specific listeners
    if (!roomId) return; // Guard against no room ID

    socket.on("connect", onConnect);
    socket.on("error-msg", onError);
    socket.on("init", onInit);
    socket.on("live-stroke-start", onLiveStrokeStart);
    socket.on("live-stroke-update", onLiveStrokeUpdate);
    socket.on("live-stroke-end", onLiveStrokeEnd);
    socket.on("draw", onDraw);
    socket.on("draw-ack", onDrawAck);
    socket.on("remove-stroke", onRemoveStroke);
    socket.on("undo-ack", onUndoAck);
    socket.on("clear", onClear);
    socket.on("cursor-update", onCursorUpdate);
    socket.on("cursor-remove", onCursorRemove);

    // --- 3. Handle connection ---
    // If we are *already* connected when this effect runs,
    // the 'connect' event won't fire, so we must manually call onConnect.
    if (socket.connected) {
      onConnect();
    }

    // --- 4. Cleanup ---
    return () => {
      // This runs when the component unmounts or [roomId] changes
      socket.off("connect", onConnect);
      socket.off("error-msg", onError);
      socket.off("init", onInit);
      socket.off("live-stroke-start", onLiveStrokeStart);
      socket.off("live-stroke-update", onLiveStrokeUpdate);
      socket.off("live-stroke-end", onLiveStrokeEnd);
      socket.off("draw", onDraw);
      socket.off("draw-ack", onDrawAck);
      socket.off("remove-stroke", onRemoveStroke);
      socket.off("undo-ack", onUndoAck);
      socket.off("clear", onClear);
      socket.off("cursor-update", onCursorUpdate);
      socket.off("cursor-remove", onCursorRemove);
    };
  }, [roomId]); // The only dependency is the room ID

  /* ------------------ Canvas setup & DPI ------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!canvas || !drawingCanvas) return;
    const ctx = canvas.getContext("2d");
    const drawingCtx = drawingCanvas.getContext("2d");
    ctx.lineCap = "round";
    drawingCtx.lineCap = "round";
    ctxRef.current = ctx;
    drawingCtxRef.current = drawingCtx;

    const resize = () => {
      const newToolbarHeight =
        toolbarRef.current?.getBoundingClientRect().height || 80;
      setToolbarHeight(newToolbarHeight);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(window.innerWidth);
      const h = Math.floor(window.innerHeight - newToolbarHeight);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawingCanvas.style.width = `${w}px`;
      drawingCanvas.style.height = `${h}px`;
      drawingCanvas.width = Math.floor(w * dpr);
      drawingCanvas.height = Math.floor(h * dpr);
      drawingCtxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll(strokesRef.current);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------ BFCache "Auto-Reload" Fix ------------------ */
  useEffect(() => {
    // This handler detects when a page is shown from the
    // browser's Back-Forward Cache (bfcache).
    const handlePageShow = (event) => {
      // event.persisted is true if the page was restored from bfcache
      if (event.persisted) {
        // The page is stale. Force a reload.
        window.location.reload();
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []); // Empty array, so it only runs once on mount

  /* ------------------ Input: Drawing Logic ------------------ */

  const getPosFromPointerEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (x, y) => {
    stablePointRef.current = { x, y }; // Init stabilizer
    if (!drawingCtxRef.current) return;

    pointerRef.current.x = x;
    pointerRef.current.y = y;

    const strokeId = genClientId();
    const newStroke = {
      id: strokeId,
      points: [{ x, y }],
      color: tool === "eraser" ? "#ffffff" : color,
      size,
      tool,
      stability,
      owner: user.current.id,
    };
    currentStrokeRef.current = newStroke;

    redrawTopCanvas();

    try {
      socket.emit("start-stroke", { roomId, stroke: newStroke });
      socket.emit("cursor-move", {
        roomId,
        cursor: {
          x,
          y,
          color: user.current.color,
          name: user.current.name,
          tool,
        },
      });
    } catch (e) {}
  };

  const continueDrawing = (x, y) => {
    try {
      socket.emit("cursor-move", {
        roomId,
        cursor: {
          x,
          y,
          color: user.current.color,
          name: user.current.name,
          tool,
        },
      });
    } catch (e) {}

    // Update eraser/pointer position *regardless* of drawing state
    pointerRef.current.x = x;
    pointerRef.current.y = y;
    pointerRef.current.visible = tool === "eraser";

    // --- GUARD CLAUSE ---
    // Only continue if we are in a drawing state
    if (!isDrawing) {
      redrawTopCanvas(); // Just to show eraser
      return;
    }
    // --------------------

    if (!drawingCtxRef.current) return;

    // Stabilizer logic
    if (!stablePointRef.current) stablePointRef.current = { x, y };
    const t = 1 - stability / 10.5;
    const stableX = lerp(stablePointRef.current.x, x, t);
    const stableY = lerp(stablePointRef.current.y, y, t);
    const stablePoint = { x: stableX, y: stableY };
    stablePointRef.current = stablePoint;

    if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push(stablePoint);
      try {
        socket.emit("continue-stroke", {
          roomId,
          id: currentStrokeRef.current.id,
          point: stablePoint,
        });
      } catch (e) {}
    }

    redrawTopCanvas();
  };

  const endDrawing = () => {
    // Clean up the global listener
    if (globalPointerUpHandlerRef.current) {
      window.removeEventListener(
        "pointerup",
        globalPointerUpHandlerRef.current
      );
      globalPointerUpHandlerRef.current = null;
    }

    const finalStroke = currentStrokeRef.current;
    currentStrokeRef.current = null;

    redrawTopCanvas(); // Clears the live stroke

    if (!finalStroke || finalStroke.points.length === 0) return;

    try {
      socket.emit("draw", { roomId, line: finalStroke });
    } catch (err) {
      console.warn("emit draw failed", err);
      showMessage("Unable to send stroke to server", "error");
      strokesRef.current.push(finalStroke);
      redrawAll(strokesRef.current);
      updateUndoRedoState();
    }
  };

  /* ------------------ Input: Pointer Event Handlers ------------------ */

  const onPointerDown = (e) => {
    if (e.button !== 0) return;

    // Create the global 'up' handler
    const handleGlobalPointerUp = () => {
      endDrawing(); // Commit the stroke
      setIsDrawing(false); // Set state to stop drawing

      // Clean up the listener itself
      if (globalPointerUpHandlerRef.current) {
        window.removeEventListener(
          "pointerup",
          globalPointerUpHandlerRef.current
        );
        globalPointerUpHandlerRef.current = null;
      }
    };

    // Save and add the listener
    globalPointerUpHandlerRef.current = handleGlobalPointerUp;
    window.addEventListener("pointerup", handleGlobalPointerUp);

    // Set state and start the drawing
    setIsDrawing(true);
    const p = getPosFromPointerEvent(e);
    startDrawing(p.x, p.y);
  };

  const onPointerMove = (e) => {
    const p = getPosFromPointerEvent(e);
    continueDrawing(p.x, p.y);
  };

  const onPointerLeave = () => {
    // Just hide cursor/eraser, DO NOT stop drawing
    try {
      socket.emit("cursor-move", { roomId, cursor: null });
    } catch {}

    pointerRef.current.visible = false; // Hide local eraser
    redrawTopCanvas();
  };

  // Cleanup effect for global listener
  useEffect(() => {
    // This cleans up the global listener if the component
    // unmounts mid-draw (e.g., user exits the room).
    return () => {
      if (globalPointerUpHandlerRef.current) {
        window.removeEventListener(
          "pointerup",
          globalPointerUpHandlerRef.current
        );
      }
    };
  }, []); // Empty dependency array, runs on mount/unmount

  /* ------------------ Actions: undo/redo/clear ------------------ */
  const handleUndo = () => {
    try {
      socket.emit("undo", roomId);
    } catch (e) {
      console.warn(e);
      showMessage("Unable to request undo", "error");
    }
  };

  const handleRedo = () => {
    try {
      const stroke = redoStackRef.current.pop();
      updateUndoRedoState(); // Update UI immediately
      if (!stroke) {
        showMessage("Nothing to redo", "info");
        return;
      }
      const newStroke = { ...stroke, id: genClientId() };
      socket.emit("redo", { roomId, stroke: newStroke });
    } catch (e) {
      console.warn(e);
      showMessage("Redo failed", "error");
    }
  };

  const clearCanvas = () => {
    try {
      socket.emit("clear", roomId);
    } catch (e) {
      console.warn(e);
      showMessage("Clear failed", "error");
    }
  };

  // --- LATEST CHANGE: Handle Exit Button ---
  const handleExit = () => {
    // Tell the server we are leaving *before* we navigate
    socket.emit("leave-room", roomId);
    // Now, navigate back to the home page
    navigate("/");
  };
  // -----------------------------------------

  /* ------------------ RENDER ------------------ */
  return (
    <div className="flex flex-col h-screen relative">
      {/* Toast */}
      {message && (
        <div
          className={`fixed top-4 right-4 z-50 px-3 py-2 rounded shadow ${
            message.type === "error"
              ? "bg-red-500 text-white"
              : "bg-black text-white"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Toolbar */}
      <div
        ref={toolbarRef}
        className="flex flex-wrap items-center justify-between bg-white shadow px-3 py-2 border-b z-20"
      >
        {/* Left tools */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-700 mr-2">
            Room: {roomId}
          </span>
          <button
            onClick={() => setTool("brush")}
            className={`px-3 py-1 rounded ${
              tool === "brush" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}
          >
            Brush
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`px-3 py-1 rounded ${
              tool === "eraser" ? "bg-orange-500 text-white" : "bg-gray-100"
            }`}
          >
            Eraser
          </button>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Size</label>
            <input
              type="range"
              min="1"
              max="80"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-36"
            />
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
            onClick={clearCanvas}
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

      {/* Canvas Stack */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="absolute top-0 left-0 bg-white" />
        <canvas
          ref={drawingCanvasRef}
          className="absolute top-0 left-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          // onPointerUp is intentionally removed (handled by window)
          onPointerLeave={onPointerLeave}
        />
      </div>

      {/* Other users cursors */}
      {Object.entries(cursors).map(([id, cursor]) => {
        // FIX: Check for null cursor
        if (id === user.current.id || !cursor) return null;
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
