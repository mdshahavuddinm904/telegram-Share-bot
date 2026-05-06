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

/* ================= MUST JOIN MIDDLEWARE ================= */      
async function mustJoin(ctx, next) {      
  const joined = await checkJoin(ctx);      
  if (!joined) return joinMsg(ctx);      
  return next();      
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

/* ================= WELCOME (NO CHANGE) ================= */      
function getWelcome() {      
  return `🎉 Welcome!      

💰 Referral System Active      

🔗 /refer - Get your referral link      
📊 /balance - Check your account      
💸 /withdraw - Withdraw money      
🎁 /bonus - Daily bonus      

🚀 Invite friends & earn money easily!`;      
}      

/* ================= JOIN BUTTON ================= */      
bot.action("check_join", async (ctx) => {      
  const db = loadDB();      
  const id = ctx.from.id;      

  const joined = await checkJoin(ctx);      
  if (!joined) return joinMsg(ctx);      

  db.users[id].joined = true;      

  const ref = db.users[id].referredBy;      

  if (ref && db.users[ref] && !db.users[id].rewarded) {      
    db.users[ref].balance += 20;      
    db.users[ref].referrals += 1;      

    bot.telegram.sendMessage(ref, "🎉 You earned $0.30 from referral!");      

    db.users[id].rewarded = true;      
  }      

  saveDB(db);      
  return ctx.reply(getWelcome());      
});      

/* ================= COMMANDS (ALL FIXED) ================= */

// REFER
bot.command("refer", mustJoin, (ctx) => {      
  const link = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;      
  ctx.reply(`🔗 Your Link:\n${link}\n\n💰 Earn $0.30 per referral`);      
});      

// BALANCE
bot.command("balance", mustJoin, (ctx) => {      
  const db = loadDB();      
  const user = db.users[ctx.from.id];      

  ctx.reply(`📊 Account Information      

👤 Username: @${ctx.from.username || "NoUsername"}      
🆔 User ID: ${ctx.from.id}      

💰 Balance: $${user?.balance || 0}      
💸 Minimum Withdraw: $5`);      
});      

// BONUS (NO CHANGE)
bot.command("bonus", mustJoin, (ctx) => {      
  const db = loadDB();      
  const user = db.users[ctx.from.id];      

  const now = Date.now();      
  if (now - user.lastBonus < 86400000) {      
    return ctx.reply("⏳ Bonus available every 24 hours");      
  }      

  user.balance += 0.30;      
  user.lastBonus = now;      

  saveDB(db);      
  ctx.reply("🎁 You received $0.35 bonus!");      
});      

// WITHDRAW (FIXED JOIN ISSUE)
bot.command("withdraw", mustJoin, (ctx) => {      
  ctx.reply(      
    "💸 Select Method:",      
    Markup.inlineKeyboard([      
      [Markup.button.callback("📱 BKash", "wd_bkash")],      
      [Markup.button.callback("📱 Nagad", "wd_nagad")],      
      [Markup.button.callback("💰 Binance", "wd_binance")],      
      [Markup.button.url("🟢 Support ID", "https://t.me/Smart_Method_Owner")]      
    ])      
  );      
});      

/* ================= WITHDRAW FLOW ================= */      
function askNumber(ctx, method) {      
  withdrawState[ctx.from.id] = { step: "number", method };      
  ctx.reply(`Enter your ${method} number:`);      
}      

bot.action("wd_bkash", (ctx) => askNumber(ctx, "BKash"));      
bot.action("wd_nagad", (ctx) => askNumber(ctx, "Nagad"));      
bot.action("wd_binance", (ctx) => askNumber(ctx, "Binance"));      

/* ================= TEXT HANDLER ================= */      
bot.on("text", async (ctx) => {      

  // ❌ BLOCK ALL COMMANDS HERE
  if (ctx.message.text.startsWith("/")) return;      

  const db = loadDB();      
  const id = ctx.from.id;      

  if (withdrawState[id]) {      
    const state = withdrawState[id];      
    const user = db.users[id];      

    if (state.step === "number") {      
      if (ctx.message.text.length < 5) {      
        return ctx.reply("❌ Invalid number!");      
      }      

      state.number = ctx.message.text;      
      state.step = "amount";      
      return ctx.reply("💰 Enter withdraw amount:");      
    }      

    if (state.step === "amount") {      
      const amount = Number(ctx.message.text);      

      if (isNaN(amount)) {      
        return ctx.reply("❌ Enter valid amount!");      
      }      

      if (!user || user.balance < amount || amount < 5) {      
        delete withdrawState[id];      
        return ctx.reply("❌ Invalid amount");      
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
Username: @${ctx.from.username || "NoUsername"}      
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
  }      
});      

/* ================= PENDING (FIXED) ================= */      
bot.command("pending", mustJoin, (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) {      
    return ctx.reply("❌ Not allowed");      
  }      

  const count = Object.keys(pendingRequests).length;      

  return ctx.reply(      
    `📊 Pending Requests: ${count}`,      
    Markup.inlineKeyboard([      
      [Markup.button.callback("📋 View Pending", "view_pending")]      
    ])      
  );      
});      

/* ================= VIEW PENDING ================= */      
bot.action("view_pending", async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      

  if (Object.keys(pendingRequests).length === 0) {      
    return ctx.reply("✅ No pending requests");      
  }      

  for (const requestId in pendingRequests) {      
    const req = pendingRequests[requestId];      

    await bot.telegram.sendMessage(      
      config.ADMIN_ID,      
      `💸 Withdraw Request      

ID: ${requestId}      
User: ${req.userId}      
Username: @${req.username || "NoUsername"}      
Amount: $${req.amount}      
Method: ${req.method}      
Number: ${req.number}`,      
      Markup.inlineKeyboard([      
        [      
          Markup.button.callback("✅ Approve", `approve_${requestId}_${req.userId}_${req.amount}`),      
          Markup.button.callback("❌ Reject", `reject_${requestId}_${req.userId}_${req.amount}`)      
        ]      
      ])      
    );      
  }      
});      

/* ================= APPROVE / REJECT (UNCHANGED) ================= */      
bot.action(/approve_(.+)_(.+)_(.+)/, async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      

  const requestId = ctx.match[1];      
  const userId = ctx.match[2];      
  const amount = Number(ctx.match[3]);      

  const db = loadDB();      
  const user = db.users[userId];      

  if (!user || user.lastRequest === requestId) return;      

  user.lastRequest = requestId;      
  delete pendingRequests[requestId];      
  saveDB(db);      

  ctx.editMessageText(`✅ Approved & Paid      

User: ${userId}      
Amount: $${amount}`);      
});      

bot.action(/reject_(.+)_(.+)_(.+)/, async (ctx) => {      
  if (ctx.from.id !== config.ADMIN_ID) return;      

  const requestId = ctx.match[1];      
  const userId = ctx.match[2];      
  const amount = Number(ctx.match[3]);      

  const db = loadDB();      
  const user = db.users[userId];      

  if (!user || user.lastRequest === requestId) return;      

  user.balance += amount;      
  user.lastRequest = requestId;      
  delete pendingRequests[requestId];      
  saveDB(db);      

  ctx.editMessageText(`❌ Withdraw Rejected`);      
});      

bot.catch(console.log);      
bot.launch();      
console.log("🚀 Bot Running...");
