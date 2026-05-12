const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");

const bot = new Telegraf("8709620585:AAFdGdwSuqLEY29SWyawApItx0C_EVqMIuM");

const ADMIN_ID = "8136997138";
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
    const res = await bot.telegram.getChatMember(
      "@MiniDemoUpdate",
      ctx.from.id
    );

    return ["creator", "administrator", "member"].includes(res.status);
  } catch {
    return false;
  }
}

/* ================= JOIN MSG ================= */
function joinMsg(ctx) {
  return ctx.reply(
    "❌ You must join channel first!",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🌍 Join Channel",
          "https://t.me/MiniDemoUpdate"
        )
      ],
      [Markup.button.callback("✅ I Joined", "check_join")]
    ])
  );
}

/* ================= STATE ================= */
const withdrawState = {};

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

/* ================= WELCOME ================= */
function getWelcome() {
  return `🎉 Welcome!

💰 Referral System Active

🔗 /refer - Get your referral link
📊 /balance - Check your account
💸 /withdraw - Withdraw money
🎁 /bonus - Daily bonus
👥 /users - Total users (Admin)

🚀 Invite friends & earn money easily!`;
}

/* ================= JOIN BUTTON ================= */
bot.action("check_join", async (ctx) => {
  const db = loadDB();

  const id = ctx.from.id;

  const joined = await checkJoin(ctx);

  if (!joined) {
    return joinMsg(ctx);
  }

  db.users[id].joined = true;

  const ref = db.users[id].referredBy;

  if (ref && db.users[ref] && !db.users[id].rewarded) {
    db.users[ref].balance += 20;
    db.users[ref].referrals += 1;

    bot.telegram.sendMessage(
      ref,
      "🎉 You earned $20 from referral!"
    );

    db.users[id].rewarded = true;
  }

  saveDB(db);

  return ctx.reply(getWelcome());
});

/* ================= MIDDLEWARE ================= */
async function mustJoin(ctx, next) {

  if (ctx.from.id.toString() === ADMIN_ID.toString()) {
    return next();
  }

  const joined = await checkJoin(ctx);

  if (!joined) {
    return joinMsg(ctx);
  }

  return next();
}

/* ================= REFER ================= */
bot.command("refer", mustJoin, (ctx) => {

  const link =
    `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  ctx.reply(
    `🔗 Your Link:\n${link}\n\n💰 Earn $20 per referral`
  );
});

/* ================= BALANCE ================= */
bot.command("balance", mustJoin, (ctx) => {

  const db = loadDB();

  const user = db.users[ctx.from.id];

  ctx.reply(
`📊 Account Information

👤 Username: @${ctx.from.username || "NoUsername"}
🆔 User ID: ${ctx.from.id}

💰 Balance: $${user?.balance || 0}
💸 Minimum Withdraw: $5`
  );
});

/* ================= BONUS ================= */
bot.command("bonus", mustJoin, (ctx) => {

  const db = loadDB();

  const user = db.users[ctx.from.id];

  const now = Date.now();

  if (now - user.lastBonus < 86400000) {
    return ctx.reply("⏳ Bonus available every 24 hours");
  }

  user.balance += 20;
  user.lastBonus = now;

  saveDB(db);

  ctx.reply("🎁 You received $20 bonus!");
});

/* ================= WITHDRAW ================= */
bot.command("withdraw", mustJoin, (ctx) => {

  ctx.reply(
    "💸 Select Withdraw Method:",
    Markup.inlineKeyboard([
      [Markup.button.callback("📱 BKash", "wd_bkash")],
      [Markup.button.callback("📱 Nagad", "wd_nagad")],
      [Markup.button.callback("💰 Binance", "wd_binance")],
      [
        Markup.button.url(
          "🟢 Support ID",
          "https://t.me/Smart_Method_Owner"
        )
      ]
    ])
  );
});

/* ================= ASK NUMBER ================= */
function askNumber(ctx, method) {

  withdrawState[ctx.from.id] = {
    step: "number",
    method
  };

  ctx.reply(`📥 Enter your ${method} number:`);
}

bot.action("wd_bkash", (ctx) => askNumber(ctx, "BKash"));
bot.action("wd_nagad", (ctx) => askNumber(ctx, "Nagad"));
bot.action("wd_binance", (ctx) => askNumber(ctx, "Binance"));

/* ================= MESSAGE ================= */
bot.on("text", async (ctx) => {

  const db = loadDB();

  const id = ctx.from.id;

  if (withdrawState[id]) {

    const state = withdrawState[id];

    const user = db.users[id];

    /* ===== NUMBER ===== */
    if (state.step === "number") {

      if (ctx.message.text.length < 5) {
        return ctx.reply("❌ Invalid number!");
      }

      state.number = ctx.message.text;

      state.step = "amount";

      return ctx.reply("💰 Enter withdraw amount:");
    }

    /* ===== AMOUNT ===== */
    if (state.step === "amount") {

      const amount = Number(ctx.message.text);

      if (isNaN(amount)) {
        return ctx.reply("❌ Enter valid amount!");
      }

      if (!user || user.balance < amount || amount < 5) {

        delete withdrawState[id];

        return ctx.reply(
          "❌ Invalid amount! Minimum withdraw is $5"
        );
      }

      const requestId = Date.now();

      user.balance -= amount;

      saveDB(db);

      await bot.telegram.sendMessage(
        ADMIN_ID,
`💸 Withdraw Request

🆔 Request ID: ${requestId}

👤 User ID: ${id}
👤 Username: @${ctx.from.username || "NoUsername"}

💰 Amount: $${amount}
🏦 Method: ${state.method}
📱 Number: ${state.number}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Approve",
              `approve_${requestId}_${id}_${amount}`
            ),

            Markup.button.callback(
              "❌ Reject",
              `reject_${requestId}_${id}_${amount}`
            )
          ]
        ])
      );

      delete withdrawState[id];

      return ctx.reply(
        "✅ Withdraw request sent successfully!"
      );
    }
  }
});

/* ================= APPROVE ================= */
bot.action(/approve_(.+)_(.+)_(.+)/, async (ctx) => {

  if (ctx.from.id.toString() !== ADMIN_ID.toString()) {
    return;
  }

  const requestId = ctx.match[1];
  const userId = ctx.match[2];
  const amount = Number(ctx.match[3]);

  const db = loadDB();

  const user = db.users[userId];

  if (!user || user.lastRequest === requestId) {
    return ctx.answerCbQuery("Already processed!");
  }

  user.lastRequest = requestId;

  saveDB(db);

  await ctx.editMessageText(
`✅ Withdraw Approved

👤 User: ${userId}
💰 Amount: $${amount}`
  );

  await bot.telegram.sendMessage(
    userId,
`✅ Your payment has been sent successfully!

💰 Amount: $${amount}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🟢 Support ID",
              url: "https://t.me/Smart_Method_Owner"
            }
          ]
        ]
      }
    }
  );
});

/* ================= REJECT ================= */
bot.action(/reject_(.+)_(.+)_(.+)/, async (ctx) => {

  if (ctx.from.id.toString() !== ADMIN_ID.toString()) {
    return;
  }

  const requestId = ctx.match[1];
  const userId = ctx.match[2];
  const amount = Number(ctx.match[3]);

  const db = loadDB();

  const user = db.users[userId];

  if (!user || user.lastRequest === requestId) {
    return ctx.answerCbQuery("Already processed!");
  }

  user.balance += amount;

  user.lastRequest = requestId;

  saveDB(db);

  await ctx.editMessageText(
`❌ Withdraw Rejected

👤 User: ${userId}
💰 Returned: $${amount}`
  );

  await bot.telegram.sendMessage(
    userId,
`❌ Your withdraw request was rejected.

💰 Amount returned to your balance.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🟢 Support ID",
              url: "https://t.me/Smart_Method_Owner"
            }
          ]
        ]
      }
    }
  );
});

/* ================= USERS ================= */
bot.command("users", mustJoin, async (ctx) => {

  if (ctx.from.id.toString() !== ADMIN_ID.toString()) {
    return ctx.reply("❌ Not allowed");
  }

  const db = loadDB();

  const totalUsers = Object.keys(db.users).length;

  ctx.reply(
`📊 Bot Statistics

👥 Total Users: ${totalUsers}`
  );
});

/* ================= ERROR ================= */
bot.catch(console.log);

/* ================= START BOT ================= */
bot.launch();

console.log("🚀 Bot Running...");
