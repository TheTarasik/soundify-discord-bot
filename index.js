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

function createControlButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("⏮️ Prev")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("⏹️ Stop")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("⏭️ Next")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("replay")
      .setLabel("🔁 Replay")
      .setStyle(ButtonStyle.Primary)
  );
}

async function playTrack(guildId, trackIndex = null) {
  const data = guildData.get(guildId);
  if (!data || data.queue.length === 0) return false;

  if (trackIndex !== null) {
    data.currentTrackIndex = trackIndex;
  }

  const currentTrack = data.queue[data.currentTrackIndex];
  if (!currentTrack) return false;

  try {
    const stream = new PassThrough();
    get(currentTrack, (res) => {
      res.pipe(stream);
    });

    const resource = createAudioResource(stream);
    data.player.play(resource);
    data.connection.subscribe(data.player);

    return true;
  } catch (error) {
    console.error("Помилка відтворення:", error);
    return false;
  }
}

async function updateQueueMessage(message, guildId) {
  const data = guildData.get(guildId);
  if (!data) return;

  const queueInfo = data.queue
    .map((track, index) => {
      const trackNum = index + 1;
      const isCurrentTrack = index === data.currentTrackIndex;
      return `${isCurrentTrack ? "▶️" : "📀"} ${trackNum}. Трек ${trackNum}`;
    })
    .join("\n");

  const content = `🎶 **Черга треків** (${data.currentTrackIndex + 1}/${
    data.queue.length
  })\n\n${queueInfo}`;

  try {
    await message.edit({
      content,
      components: [createControlButtons()],
    });
  } catch (error) {
    console.error("Помилка оновлення повідомлення:", error);
  }
}

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!play") || message.author.bot) return;

  const args = message.content.split(" ");
  const mp3Url = args[1];

  if (
    !mp3Url ||
    !mp3Url.startsWith("https://files.soundify.one/static/media/")
  ) {
    message.reply("❌ Введи пряме посилання на трек");
    return;
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    message.reply("🔊 Зайди спершу в голосовий канал!");
    return;
  }

  let data = guildData.get(message.guild.id);

  if (!data || !data.connection) {
    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();

      data = {
        connection,
        player,
        queue: [mp3Url],
        currentTrackIndex: 0,
        controlMessage: null,
      };

      guildData.set(message.guild.id, data);

      player.on(AudioPlayerStatus.Idle, async () => {
        const currentData = guildData.get(message.guild.id);
        if (!currentData) return;

        if (currentData.currentTrackIndex < currentData.queue.length - 1) {
          currentData.currentTrackIndex++;
          const success = await playTrack(message.guild.id);

          if (success && currentData.controlMessage) {
            await updateQueueMessage(
              currentData.controlMessage,
              message.guild.id
            );
          }
        } else {
          connection.destroy();
          guildData.delete(message.guild.id);

          if (currentData.controlMessage) {
            try {
              await currentData.controlMessage.edit({
                content: "✅ Черга треків завершена!",
                components: [],
              });
            } catch (error) {
              console.error("Помилка оновлення повідомлення:", error);
            }
          }
        }
      });

      await playTrack(message.guild.id);

      const controlMessage = await message.reply({
        content: `🎶 **Черга треків** (1/1)\n\n▶️ 1. Трек 1`,
        components: [createControlButtons()],
      });

      data.controlMessage = controlMessage;
    } catch (err) {
      console.error(err);
      message.reply("🚫 Помилка під час підключення до голосового каналу");
    }
  } else {
    data.queue.push(mp3Url);

    if (data.controlMessage) {
      await updateQueueMessage(data.controlMessage, message.guild.id);
    }

    message.reply(`✅ Трек додано до черги! Позиція: ${data.queue.length}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const guildId = interaction.guildId;
  const data = guildData.get(guildId);

  if (!data || !data.connection) {
    await interaction.reply({
      content: "⛔ Бот не активний або черга порожня",
      ephemeral: true,
    });
    return;
  }

  switch (interaction.customId) {
    case "stop":
      data.player.stop();
      data.connection.destroy();
      guildData.delete(guildId);

      await interaction.update({
        content: "🛑 Відтворення зупинено і черга очищена",
        components: [],
      });
      break;

    case "next":
      if (data.currentTrackIndex < data.queue.length - 1) {
        data.currentTrackIndex++;
        const success = await playTrack(guildId);

        if (success) {
          await updateQueueMessage(interaction.message, guildId);
          await interaction.reply({
            content: `⏭️ Перехід до наступного треку (${
              data.currentTrackIndex + 1
            }/${data.queue.length})`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "❌ Помилка переходу до наступного треку",
            ephemeral: true,
          });
        }
      } else {
        await interaction.reply({
          content: "⏭️ Це останній трек у черзі",
          ephemeral: true,
        });
      }
      break;

    case "prev":
      if (data.currentTrackIndex > 0) {
        data.currentTrackIndex--;
        const success = await playTrack(guildId);

        if (success) {
          await updateQueueMessage(interaction.message, guildId);
          await interaction.reply({
            content: `⏮️ Перехід до попереднього треку (${
              data.currentTrackIndex + 1
            }/${data.queue.length})`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "❌ Помилка переходу до попереднього треку",
            ephemeral: true,
          });
        }
      } else {
        await interaction.reply({
          content: "⏮️ Це перший трек у черзі",
          ephemeral: true,
        });
      }
      break;

    case "replay":
      const success = await playTrack(guildId);

      if (success) {
        await interaction.reply({
          content: `🔁 Повтор поточного треку (${data.currentTrackIndex + 1}/${
            data.queue.length
          })`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "❌ Помилка повтору треку",
          ephemeral: true,
        });
      }
      break;
  }
});

client.login(TOKEN);
