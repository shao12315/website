const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const MIME_TYPES = {
  ".csv": "text/csv; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const sessions = new Map();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    const seed = {
      admins: [
        {
          id: "admin-1",
          username: "admin",
          name: "System Admin",
          passwordHash: sha256("admin123"),
          role: "super_admin"
        }
      ],
      users: [
        {
          id: "user-1",
          username: "zhangsan",
          name: "Zhang San",
          phone: "13800000001",
          role: "editor",
          status: "active",
          createdAt: new Date().toISOString()
        },
        {
          id: "user-2",
          username: "lisi",
          name: "Li Si",
          phone: "13800000002",
          role: "viewer",
          status: "disabled",
          createdAt: new Date().toISOString()
        }
      ]
    };

    fs.writeFileSync(USERS_FILE, JSON.stringify(seed, null, 2), "utf8");
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice("Bearer ".length).trim();
}

function getSession(req) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) return null;
  return sessions.get(token);
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { message: "Unauthorized" });
    return null;
  }
  return session;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone || "",
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function buildAiSuggestion(message) {
  return [
    "系统建议：当前页面已接入本地服务端。",
    "如潮位和涌高偏高，请优先安排现场疏导、分区观潮和广播提醒。",
    "建议管理员在后台维护值守人员账号，并对外发布前再次确认数据更新时间。",
    `分析依据：${String(message || "").slice(0, 120)}`
  ].join("\n");
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await parseBody(req);
    const store = readStore();
    const admin = store.admins.find(
      item => item.username === String(body.username || "").trim()
    );

    if (!admin || admin.passwordHash !== sha256(body.password || "")) {
      sendJson(res, 401, { message: "用户名或密码错误" });
      return;
    }

    const token = createToken();
    const profile = {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      role: admin.role
    };
    sessions.set(token, profile);
    sendJson(res, 200, { token, profile });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/me") {
    const session = requireAuth(req, res);
    if (!session) return;
    sendJson(res, 200, { profile: session });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = getToken(req);
    if (token) {
      sessions.delete(token);
    }
    sendJson(res, 200, { success: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/deepseek") {
  const body = await parseBody(req);

  // 验证请求
  if (!body.message || String(body.message).trim() === "") {
    sendJson(res, 400, { message: "message 字段不能为空" });
    return;
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || "sk-bf5ebb1a02e24a969781433b26b24718").trim();
  
  console.log("[DeepSeek] 收到请求:", { message: body.message.substring(0, 50) });
  console.log("[DeepSeek] 使用的API KEY:", apiKey.substring(0, 10) + "***");
  
  // 检查API KEY是否配置（只检查是否为空和是否包含占位符）
  if (!apiKey || apiKey.includes("这里填")) {
    console.warn("[DeepSeek] API KEY 未配置，使用本地备用方案");
    // 使用本地内置规则生成建议
    const localAdvice = [
      "系统建议（本地规则）：当前未配置真实的 DeepSeek API Key。",
      "如潮位和涌高偏高，请优先安排现场疏导、分区观潮和广播提醒。",
      "建议管理员在后台维护值守人员账号，并对外发布前再次确认数据更新时间。",
      `用户问题：${String(body.message || "").slice(0, 120)}`
    ].join("\n");
    
    sendJson(res, 200, {
      choices: [
        {
          message: {
            content: localAdvice,
            role: "assistant"
          }
        }
      ]
    });
    return;
  }

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是一个潮汐分析助手" },
          { role: "user", content: String(body.message).trim() }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const text = await response.text();

    console.log("====== DeepSeek返回原始内容 ======");
    console.log(text);
    console.log("=================================");

    console.log(`[DeepSeek] 状态码: ${response.status}`);
    
    // 检查HTTP状态码
    if (!response.ok) {
      console.error(`[DeepSeek] 错误响应: ${text}`);
      return sendJson(res, 502, {
        message: "DeepSeek API 返回错误",
        status: response.status,
        detail: text.slice(0, 200)
      });
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("[DeepSeek] JSON 解析失败:", e.message);
      return sendJson(res, 502, {
        message: "AI返回格式错误",
        detail: text.slice(0, 200)
      });
    }

    // 验证返回格式
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("[DeepSeek] 返回格式不符合预期:", JSON.stringify(data).slice(0, 200));
      return sendJson(res, 502, {
        message: "AI返回格式异常",
        detail: "缺少预期的 choices[0].message 字段"
      });
    }

    sendJson(res, 200, data);

  } catch (error) {
    console.error("[DeepSeek] 请求异常:", error.message);
    sendJson(res, 502, {
      message: "AI 调用失败",
      detail: error.message
    });
  }

  return;
}

  if (url.pathname === "/api/users") {
    const session = requireAuth(req, res);
    if (!session) return;

    if (req.method === "GET") {
      const store = readStore();
      sendJson(res, 200, { users: store.users.map(sanitizeUser) });
      return;
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const store = readStore();
      const username = String(body.username || "").trim();
      const name = String(body.name || "").trim();

      if (!username || !name) {
        sendJson(res, 400, { message: "用户名和姓名不能为空" });
        return;
      }

      if (store.users.some(item => item.username === username)) {
        sendJson(res, 409, { message: "用户名已存在" });
        return;
      }

      const user = {
        id: `user-${Date.now()}`,
        username,
        name,
        phone: String(body.phone || "").trim(),
        role: String(body.role || "viewer"),
        status: body.status === "disabled" ? "disabled" : "active",
        createdAt: new Date().toISOString()
      };

      store.users.unshift(user);
      writeStore(store);
      sendJson(res, 201, { user: sanitizeUser(user) });
      return;
    }
  }

  if (url.pathname.startsWith("/api/users/")) {
    const session = requireAuth(req, res);
    if (!session) return;

    const userId = decodeURIComponent(url.pathname.replace("/api/users/", ""));
    const store = readStore();
    const index = store.users.findIndex(item => item.id === userId);

    if (index === -1) {
      sendJson(res, 404, { message: "用户不存在" });
      return;
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      const username = String(body.username || "").trim();
      const name = String(body.name || "").trim();

      if (!username || !name) {
        sendJson(res, 400, { message: "用户名和姓名不能为空" });
        return;
      }

      const duplicate = store.users.find(
        item => item.id !== userId && item.username === username
      );
      if (duplicate) {
        sendJson(res, 409, { message: "用户名已存在" });
        return;
      }

      store.users[index] = {
        ...store.users[index],
        username,
        name,
        phone: String(body.phone || "").trim(),
        role: String(body.role || "viewer"),
        status: body.status === "disabled" ? "disabled" : "active"
      };

      writeStore(store);
      sendJson(res, 200, { user: sanitizeUser(store.users[index]) });
      return;
    }

    if (req.method === "DELETE") {
      const [removed] = store.users.splice(index, 1);
      writeStore(store);
      sendJson(res, 200, { user: sanitizeUser(removed), success: true });
      return;
    }
  }

  sendJson(res, 404, { message: "API not found" });
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      sendText(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(buffer);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      message: "Server error",
      detail: error.message
    });
  }
});

ensureDataFile();

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log("Default admin: admin / admin123");
});
