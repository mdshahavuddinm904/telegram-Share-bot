const { Telegraf, Markup } = require("telegraf");      
const fs = require("fs");      
const config = require("./config");      

const bot = new Telegraf(config.BOT_TOKEN);      
const DB_FILE = "./db.json";      

/* ================= DB ================= */      
function loadDB() {      
  if (!fs.existsSync(DB_FILE)) {      
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));      
  }      
  return JSON.parse(fs.readFileSync(DB_FILE));      
}      

function saveDB(data) {      
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));      
}      

/* ================= JOIN CHECK ================= */      
async function checkJoin(ctx) {      
  try {      
    const res = await bot.telegram.getChatMember("@Global_Method_Channel", ctx.from.id);      
    return ["creator", "administrator", "member"].includes(res.status);      
  } catch {      
    return false;      
  }      
}      

function joinMsg(ctx) {      
  return ctx.reply(      
    "❌ You must join channel first!",      
    Markup.inlineKeyboard([      
      [Markup.button.url("🌍 Join Channel", "https://t.me/Global_Method_Channel")],      
      [Markup.button.callback("✅ I Joined", "check_join")]      
    ])      
  );      
}      

/* ================= STATE ================= */      
const withdrawState = {};      
const pendingRequests = {};      

/* ================= START ================= */      
bot.start(async (ctx) => {      
  const db = loadDB();      
  const id = ctx.from.id;      
  const ref = ctx.startPayload;      

  if (!db.users[id]) {      
    db.users[id] = {      
      balance: 0,      
      referrals: 0,      
      joined: false,      
      referredBy: ref || null,      
      rewarded: false,      
      lastBonus: 0,      
      lastRequest: null      
    };      
  }      

  const joined = await checkJoin(ctx);      
  if (!joined) {      
    saveDB(db);      
    return joinMsg(ctx);      
  }      

  db.users[id].joined = true;      
  saveDB(db);      

  return ctx.reply(getWelcome());      
});      

function getWelcome() {      
  return `🎉 Welcome!      

💰 Referral System Active      

🔗 /refer - Get your referral link      
📊 /balance - Check your account      
💸 /withdraw - Withdraw money      
🎁 /bonus - Daily bonus      

🚀 Invite friends & earn money easily!`;      
}      

/* ================= BONUS (FIXED) ================= */      
bot.command("bonus", async (ctx) => {      
  const db = loadDB();      
  const user = db.users[ctx.from.id];      

  const now = Date.now();      

  if (!user) return;      

  if (now - user.lastBonus < 86400000) {      
    return ctx.reply("⏳ Bonus available every 24 hours");      
  }      

  user.balance += 0.30;      
  user.lastBonus = now;      

  saveDB(db);      
  return ctx.reply("🎁 You received $0.30 bonus!");      
});      

/* ================= WITHDRAW START (FIXED) ================= */      
bot.command("withdraw", async (ctx) => {      
  ctx.reply(      
    "💸 Select Method:",      
    Markup.inlineKeyboard([      
      [Markup.button.callback("📱 BKash", "wd_bkash")],      
      [Markup.button.callback("📱 Nagad", "wd_nagad")],      
      [Markup.button.callback("💰 Binance", "wd_binance")],      
      [Markup.button.url("🟢 Support", "https://t.me/Smart_Method_Owner")]      
    ])      
  );      
});      

function askNumber(ctx, method) {      
  withdrawState[ctx.from.id] = { step: "number", method };      
  ctx.reply(`📱 Enter your ${method} number:`);      
}      

bot.action("wd_bkash", (ctx) => askNumber(ctx, "BKash"));      
bot.action("wd_nagad", (ctx) => askNumber(ctx, "Nagad"));      
bot.action("wd_binance", (ctx) => askNumber(ctx, "Binance"));      

/* ================= TEXT HANDLER (FIXED SAFE) ================= */      
bot.on("text", async (ctx) => {      

  // ignore commands
  if (ctx.message.text.startsWith("/")) return;

  const db = loadDB();      
  const id = ctx.from.id;      

  if (!withdrawState[id]) return;      

  const state = withdrawState[id];      
  const user = db.users[id];      

  if (!user) return;      

  /* STEP 1 NUMBER */      
  if (state.step === "number") {      
    state.number = ctx.message.text;      
    state.step = "amount";      
    return ctx.reply("💰 Enter withdraw amount:");      
  }      

  /* STEP 2 AMOUNT */      
  if (state.step === "amount") {      
    const amount = Number(ctx.message.text);      

    if (isNaN(amount)) return ctx.reply("❌ Invalid amount");      
    if (amount < 5 || user.balance < amount) {      
      delete withdrawState[id];      
      return ctx.reply("❌ Not enough balance");      
    }      

    const requestId = Date.now();      

    user.balance -= amount;      
    saveDB(db);      

    pendingRequests[requestId] = {      
      userId: id,      
      amount,      
      method: state.method,      
      number: state.number,      
      username: ctx.from.username      
    };      

    await bot.telegram.sendMessage(      
      config.ADMIN_ID,      
      `💸 Withdraw Request      

ID: ${requestId}      
User: ${id}      
Amount: $${amount}      
Method: ${state.method}      
Number: ${state.number}`,      
      Markup.inlineKeyboard([      
        [      
          Markup.button.callback("✅ Approve", `approve_${requestId}_${id}_${amount}`),      
          Markup.button.callback("❌ Reject", `reject_${requestId}_${id}_${amount}`)      
        ]      
      ])      
    );      

    delete withdrawState[id];      
    return ctx.reply("✅ Request sent!");      
  }      
});      

/* ================= PENDING (FIXED) ================= */      
bot.command("pending", (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return ctx.reply("❌ Not allowed");      

  const count = Object.keys(pendingRequests).length;      

  return ctx.reply(      
    `📊 Pending Requests: ${count}`,      
    Markup.inlineKeyboard([      
      [Markup.button.callback("📋 View Pending", "view_pending")]      
    ])      
  );      
});      

bot.action("view_pending", async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      

  for (const id in pendingRequests) {      
    const req = pendingRequests[id];      

    await bot.telegram.sendMessage(      
      config.ADMIN_ID,      
      `💸 Request ID: ${id}      
User: ${req.userId}      
Amount: ${req.amount}`,      
      Markup.inlineKeyboard([      
        [      
          Markup.button.callback("✅ Approve", `approve_${id}_${req.userId}_${req.amount}`),      
          Markup.button.callback("❌ Reject", `reject_${id}_${req.userId}_${req.amount}`)      
        ]      
      ])      
    );      
  }      
});      

/* ================= APPROVE / REJECT (UNCHANGED) ================= */      
bot.action(/approve_(.+)_(.+)_(.+)/, async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      
  const [ , id, userId, amount ] = ctx.match;      
  delete pendingRequests[id];      
  ctx.editMessageText("✅ Approved");      
});      

bot.action(/reject_(.+)_(.+)_(.+)/, async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      
  const [ , id, userId, amount ] = ctx.match;      
  delete pendingRequests[id];      
  ctx.editMessageText("❌ Rejected");      
});      

bot.catch(console.log);      
bot.launch();      
console.log("🚀 Bot Running...");
