const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();

// 设置静态文件目录
app.use(express.static(path.join(__dirname, "public")));

// 所有路由都返回index.html，让前端路由处理
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 状态存储文件路径
const STATE_FILE = path.join(__dirname, "state.json");

// 初始化状态
let state = {
  stones: new Map(),
  waterLevel: 240,
  waterHeight: 10,
};

// 加载保存的状态
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf8");
      const savedState = JSON.parse(data);
      state.waterLevel = savedState.waterLevel || 240;
      state.waterHeight = savedState.waterHeight || 10;

      // 恢复石子状态
      state.stones = new Map();
      (savedState.stones || []).forEach((stone) => {
        state.stones.set(stone.id, {
          id: stone.id,
          x: stone.x,
          y: stone.y,
          clientId: stone.clientId,
        });
      });
    }
  } catch (err) {
    console.error("加载状态失败:", err);
  }
}

// 保存当前状态
function saveState() {
  try {
    const data = {
      waterLevel: state.waterLevel,
      waterHeight: state.waterHeight,
      stones: Array.from(state.stones.values()).map((stone) => ({
        id: stone.id,
        x: stone.x,
        y: stone.y,
        clientId: stone.clientId,
      })),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data), "utf8");
  } catch (err) {
    console.error("保存状态失败:", err);
  }
}

// 启动时加载状态
loadState();

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // 发送当前状态
  socket.emit("init", {
    stones: Array.from(state.stones.values()),
    waterLevel: state.waterLevel,
    waterHeight: state.waterHeight,
  });

  // 处理初始化请求
  socket.on("requestInit", () => {
    socket.emit("init", {
      stones: Array.from(state.stones.values()),
      waterLevel: state.waterLevel,
      waterHeight: state.waterHeight,
    });
  });

  // 处理石子添加
  socket.on("addStone", (data) => {
    const stone = {
      id: data.id,
      x: data.x,
      y: data.y,
      clientId: socket.id,
    };

    state.stones.set(data.id, stone);
    io.emit("stoneAdded", stone);
    saveState();
  });

  // 处理石子位置更新
  socket.on("updateStone", (data) => {
    if (state.stones.has(data.id)) {
      state.stones.set(data.id, {
        ...state.stones.get(data.id),
        x: data.x,
        y: data.y,
      });
      io.emit("stoneUpdated", data);
      saveState();
    }
  });

  // 处理水位更新
  socket.on("updateWater", (data) => {
    state.waterLevel = data.level;
    state.waterHeight = data.height;
    io.emit("waterUpdated", data);
    saveState();
  });

  // 客户端断开连接
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    // 清理该客户端创建的石子
    Array.from(state.stones.entries()).forEach(([id, stone]) => {
      if (stone.clientId === socket.id) {
        state.stones.delete(id);
        io.emit("stoneRemoved", id);
      }
    });
    saveState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 程序退出时保存状态
process.on("SIGINT", () => {
  saveState();
  process.exit();
});
