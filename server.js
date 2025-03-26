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

// 用户管理
const connectedUsers = new Map(); // 存储连接的用户信息

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

// 获取所有在线用户列表
function getAllUsers() {
  return Array.from(connectedUsers.entries()).map(([id, userData]) => ({
    id,
    name: userData.name || `用户${id.substring(0, 4)}`,
  }));
}

// 启动时加载状态
loadState();

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // 添加用户到连接列表
  connectedUsers.set(socket.id, {
    id: socket.id,
    name: `访客${socket.id.substring(0, 4)}`,
    joinTime: Date.now(),
  });

  // 处理用户信息
  socket.on("userInfo", (data) => {
    if (data.name) {
      connectedUsers.set(socket.id, {
        ...connectedUsers.get(socket.id),
        name: data.name,
      });

      // 广播用户加入事件
      io.emit("userJoined", {
        id: socket.id,
        name: data.name,
      });
    }
  });

  // 处理用户列表请求
  socket.on("requestUsers", () => {
    socket.emit("usersList", getAllUsers());
  });

  // 发送当前状态
  socket.on("requestInit", () => {
    loadState();
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
    socket.broadcast.emit("stoneAdded", stone); // 只广播给其他客户端
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
      socket.broadcast.emit("stoneUpdated", data); // 只广播给其他客户端
      saveState();
    }
  });

  // 处理水位更新
  socket.on("updateWater", (data) => {
    state.waterLevel = data.level;
    state.waterHeight = data.height;
    socket.broadcast.emit("waterUpdated", data); // 只广播给其他客户端
    saveState();
  });

  // 处理重置请求
  socket.on("reset", () => {
    // 可以选择是否真正重置状态，或者只是通知其他客户端
    socket.broadcast.emit("reset");
  });

  // 客户端断开连接
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);

    // 从用户列表中移除
    if (connectedUsers.has(socket.id)) {
      connectedUsers.delete(socket.id);

      // 广播用户离开事件
      io.emit("userLeft", socket.id);
    }

    // 不再清理石子，保留状态
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
