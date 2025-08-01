const {
  Client,
  GatewayIntentBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Events,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { get } = require("https");
const { PassThrough } = require("stream");

require("dotenv").config();
const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const guildData = new Map();

client.once("ready", () => {
  console.log(`✅ Бот увімкнений як ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!play") || message.author.bot) return;

  const args = message.content.split(" ");
  const mp3Url = args[1];

  if (
    !mp3Url ||
    !mp3Url.startsWith("https://files.soundify.one/static/media/")
  ) {
    message.reply("❌ Введи пряме посилання");
    return;
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    message.reply("🔊 Зайди спершу в голосовий канал!");
    return;
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();

    const stream = new PassThrough();
    get(mp3Url, (res) => {
      res.pipe(stream);
    });

    const resource = createAudioResource(stream);

    guildData.set(message.guild.id, {
      connection,
      player,
      resource,
      mp3Url,
    });

    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
      guildData.delete(message.guild.id);
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stop")
        .setLabel("⏹️ Stop")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("replay")
        .setLabel("▶️ Replay")
        .setStyle(ButtonStyle.Primary)
    );

    await message.reply({
      content: "🎶 Відтворення...",
      components: [row],
    });
  } catch (err) {
    console.error(err);
    message.reply("🚫 Помилка під час програвання треку");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const guildId = interaction.guildId;
  const data = guildData.get(guildId);

  if (!data) {
    await interaction.reply({
      content: "⛔ Трек не відтворюється",
      ephemeral: true,
    });
    return;
  }

  const { connection, player, mp3Url } = data;

  if (interaction.customId === "stop") {
    player.stop();
    connection.destroy();

    guildData.set(guildId, {
      ...data,
      connection: null,
      player: null,
      resource: null,
      isStopped: true,
    });

    await interaction.reply({
      content:
        "🛑 Відтворення зупинено. Натисни ▶️ Replay, щоб знову увімкнути.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "replay") {
    let { connection, player, isStopped } = data;

    if (isStopped || !connection || !player) {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        await interaction.reply({
          content: "🔊 Зайди в голосовий канал, щоб повторно увімкнути трек.",
          ephemeral: true,
        });
        return;
      }

      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      player = createAudioPlayer();

      guildData.set(guildId, {
        ...data,
        connection,
        player,
        isStopped: false,
      });
    }

    const stream = new PassThrough();
    get(mp3Url, (res) => {
      res.pipe(stream);
    });

    const resource = createAudioResource(stream);
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
      guildData.set(guildId, {
        ...guildData.get(guildId),
        connection: null,
        player: null,
        resource: null,
        isStopped: true,
      });
    });

    await interaction.reply({
      content: "🔁 Відтворення з початку",
      ephemeral: true,
    });
  }
});

client.login(TOKEN);
