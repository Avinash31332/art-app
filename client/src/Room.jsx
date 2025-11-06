// client/src/Room.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Toolbar from "./Toolbar";
import Canvas from "./Canvas";
// NOTE: This file expects 'drawStroke' but NOT 'drawEraserOverlay'
// from drawingUtils, as the eraser overlay is handled by the white mask.
import { drawStroke } from "./drawingUtils";

const socket = io("https://art-app-server.onrender.com");

// --- Helpers ---
const randomColor = () => `hsl(${Math.random() * 360}, 80%, 60%)`;
const randomName = () => "User" + Math.floor(Math.random() * 1000);
const genClientId = () =>
  `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(
    36
  )}`;
const lerp = (a, b, t) => a + (b - a) * t;

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // --- Refs ---
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const drawingCtxRef = useRef(null);
  const user = useRef({ name: randomName(), color: randomColor(), id: null });

  // State Refs
  const strokesRef = useRef([]);
  const redoStackRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const liveStrokesRef = useRef(new Map());
  const stablePointRef = useRef(null);
  const pointerRef = useRef({ x: 0, y: 0, visible: false });
  const globalPointerUpHandlerRef = useRef(null);

  // --- React State ---
  const [toolbarHeight, setToolbarHeight] = useState(80);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState("brush");
  const [brush, setBrush] = useState("pen");
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(12);
  const [opacity, setOpacity] = useState(1);
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
    if (!myId) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const hasOwn = strokesRef.current.some((s) => s.owner === myId);
    setCanUndo(Boolean(hasOwn));
    setCanRedo(Boolean(redoStackRef.current.length));
  };

  const redrawAll = (strokes) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < strokes.length; i++) {
      drawStroke(ctx, strokes[i]);
    }
  };

  const redrawTopCanvas = () => {
    const ctx = drawingCtxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw other users' live strokes
    liveStrokesRef.current.forEach((stroke) => {
      if (stroke.tool === "eraser") {
        const eraserShapeStroke = {
          ...stroke,
          tool: "brush",
          color: "#FFFFFF", // White mask
        };
        drawStroke(ctx, eraserShapeStroke);
      } else {
        drawStroke(ctx, stroke);
      }
    });

    // Draw our own live stroke
    if (currentStrokeRef.current) {
      if (currentStrokeRef.current.tool === "eraser") {
        const eraserShapeStroke = {
          ...currentStrokeRef.current,
          tool: "brush",
          color: "#FFFFFF", // White mask
        };
        drawStroke(ctx, eraserShapeStroke);
      } else {
        drawStroke(ctx, currentStrokeRef.current);
      }
    }
  };

  /* ------------------ Socket + listeners ------------------ */
  useEffect(() => {
    const onConnect = () => {
      console.log("Socket connected:", socket.id);
      user.current.id = socket.id;
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
      updateUndoRedoState();
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

    // --- FIX FOR 1-SECOND LAG ---
    const onDrawAck = (stroke) => {
      // The stroke is now committed.
      // Clear the "live" version from the top canvas.
      currentStrokeRef.current = null;

      strokesRef.current.push(stroke);
      redoStackRef.current = [];
      redrawAll(strokesRef.current); // Draw on bottom canvas
      redrawTopCanvas(); // Clear top canvas
      updateUndoRedoState();
    };
    // ----------------------------

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
    if (!roomId) return;
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
    if (socket.connected) {
      onConnect();
    }
    return () => {
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
  }, [roomId]);

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
      const toolbarEl = canvas.parentElement.parentElement.firstChild;
      const newToolbarHeight = toolbarEl?.getBoundingClientRect().height || 80;
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
  }, []);

  /* ------------------ BFCache "Auto-Reload" Fix ------------------ */
  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  /* ------------------ Input: Drawing Logic ------------------ */

  const getPosFromPointerEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (x, y) => {
    stablePointRef.current = { x, y };
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
      brush,
      stability,
      opacity,
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

    pointerRef.current.x = x;
    pointerRef.current.y = y;

    if (!isDrawing) {
      redrawTopCanvas();
      return;
    }
    if (!drawingCtxRef.current) return;

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

  // --- FIX FOR 1-SECOND LAG ---
  const endDrawing = () => {
    if (globalPointerUpHandlerRef.current) {
      window.removeEventListener(
        "pointerup",
        globalPointerUpHandlerRef.current
      );
      globalPointerUpHandlerRef.current = null;
    }

    const finalStroke = currentStrokeRef.current;

    // We DO NOT clear the currentStrokeRef or redraw the top canvas here.
    // We let the 'draw-ack' listener handle that to prevent the flicker.

    if (!finalStroke || finalStroke.points.length === 0) {
      currentStrokeRef.current = null; // No stroke, so just clear it.
      return;
    }

    try {
      socket.emit("draw", { roomId, line: finalStroke });
    } catch (err) {
      // Fallback in case socket fails
      console.warn("emit draw failed", err);
      showMessage("Unable to send stroke to server", "error");
      strokesRef.current.push(finalStroke);
      currentStrokeRef.current = null; // Clear live stroke
      redrawAll(strokesRef.current);
      redrawTopCanvas(); // Clear top canvas
      updateUndoRedoState();
    }
  };
  // ----------------------------

  /* ------------------ Input: Pointer Event Handlers ------------------ */

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const handleGlobalPointerUp = () => {
      endDrawing();
      setIsDrawing(false);
      if (globalPointerUpHandlerRef.current) {
        window.removeEventListener(
          "pointerup",
          globalPointerUpHandlerRef.current
        );
        globalPointerUpHandlerRef.current = null;
      }
    };
    globalPointerUpHandlerRef.current = handleGlobalPointerUp;
    window.addEventListener("pointerup", handleGlobalPointerUp);
    setIsDrawing(true);
    const p = getPosFromPointerEvent(e);
    startDrawing(p.x, p.y);
  };

  const onPointerMove = (e) => {
    const p = getPosFromPointerEvent(e);
    continueDrawing(p.x, p.y);
  };

  const onPointerLeave = () => {
    try {
      socket.emit("cursor-move", { roomId, cursor: null });
    } catch {}

    pointerRef.current.visible = false; // This is for the dashed overlay, which isn't used here, but is harmless.
    redrawTopCanvas();
  };

  // Cleanup effect for global listener
  useEffect(() => {
    return () => {
      if (globalPointerUpHandlerRef.current) {
        window.removeEventListener(
          "pointerup",
          globalPointerUpHandlerRef.current
        );
      }
    };
  }, []);

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
      updateUndoRedoState();
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

  const handleClear = () => {
    try {
      socket.emit("clear", roomId);
    } catch (e) {
      console.warn(e);
      showMessage("Clear failed", "error");
    }
  };

  const handleExit = () => {
    socket.emit("leave-room", roomId);
    navigate("/");
  };

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

      {/* Toolbar Component */}
      <Toolbar
        roomId={roomId}
        tool={tool}
        setTool={setTool}
        brush={brush}
        setBrush={setBrush}
        color={color}
        setColor={setColor}
        size={size}
        setSize={setSize}
        opacity={opacity}
        setOpacity={setOpacity}
        stability={stability}
        setStability={setStability}
        canUndo={canUndo}
        handleUndo={handleUndo}
        canRedo={canRedo}
        handleRedo={handleRedo}
        handleClear={handleClear}
        handleExit={handleExit}
      />

      {/* Canvas Component */}
      <Canvas
        canvasRef={canvasRef}
        drawingCanvasRef={drawingCanvasRef}
        tool={tool} // <-- Pass tool prop
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        cursors={cursors}
        toolbarHeight={toolbarHeight}
        userId={user.current.id}
      />
    </div>
  );
}
