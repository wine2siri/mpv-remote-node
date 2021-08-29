const os = require("os");
const process = require("process");
const fs = require("fs");
const fs_async = require("fs").promises;
const path = require("path");
const URL = require("url").URL;

const express = require("express");
const cors = require("cors");
const http = require("http");
const mpvAPI = require("node-mpv");

const yargs = require("yargs");

const FILE_FORMATS = require("./fileformats").FILE_FORMATS;
const {
  initDB,
  createCollection,
  getCollections,
  updateCollection,
  deleteCollection,
  createCollectionEntry,
  deleteCollectionEntry,
  getMediastatusEntries,
} = require("./crud");

const argv = yargs
  .option("webport", {
    description: "Server port",
    alias: "p",
    type: "number",
    default: 8000,
  })
  .option("uselocaldb", {
    description: "Use database for storing collection & mediastatus",
    type: "boolean",
    default: false,
  })
  .option("filebrowserpaths", {
    description: "File browser paths, which can be accessed by the server",
    type: "array",
  })
  .help()
  .alias("help", "h").argv;

// Get internal IP address
const SERVER_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i.family == "IPv4" && !i.internal).address;
const SERVER_PORT = argv.webport;
let FILEBROWSER_PATHS = argv.filebrowserpaths || [];

FILEBROWSER_PATHS = FILEBROWSER_PATHS.map((el, index) => {
  return {
    index,
    path: el,
  };
});

const socketName = argv._[0];
if (argv._.length == 0) {
  console.log("No socket provided");
  process.exit();
}

console.log(argv);
const CORSOPTIONS = {
  origin: "*",
  methods: ["GET", "POST", "DELETE", "UPDATE", "PUT", "PATCH"],
};

const app = express();
app.use(cors(CORSOPTIONS));
app.use(express.json());

const mpv = new mpvAPI({
  socket: socketName,
  verbose: false,
});

function stringIsAValidUrl(s) {
  try {
    new URL(s);
    return true;
  } catch (err) {
    return false;
  }
}

function detectFileType(extension) {
  extension = extension.toLowerCase();

  if (FILE_FORMATS.video.includes(extension)) {
    return "video";
  } else if (FILE_FORMATS.audio.includes(extension)) {
    return "audio";
  } else if (FILE_FORMATS.subtitle.includes(extension)) {
    return "subtitle";
  } else {
    return "file";
  }
}

async function getDirectoryContents(qpath) {
  // TODO Handle exceptions
  // TODO: Sorting
  let content = [];

  // Add path seperator to qpath end
  /*
  Interesting because C: (System partition) needs a path seperator to work correctly,
  but for my network drives works without path sep.
  */
  if (qpath[qpath.length - 1] != path.sep) qpath += path.sep;
  let mediaStatus = [];

  if (argv.uselocaldb) mediaStatus = await getMediastatusEntries(null, qpath);

  for (const item of await fs_async.readdir(qpath)) {
    try {
      if (fs.lstatSync(path.join(qpath, item)).isDirectory()) {
        let entry = {
          priority: 1,
          type: "directory",
          name: item,
          fullPath: path.join(qpath, item),
        };
        entry.lastModified = await fs_async
          .stat(entry.fullPath)
          .then((stat) => stat.mtime)
          .catch(() => null);

        content.push(entry);
      } else {
        let fileType = detectFileType(path.extname(item));
        // Render only media, sub types.
        if (fileType !== "file") {
          let entry = {
            priority: 2,
            type: fileType,
            name: item,
            fullPath: path.join(qpath, item),
          };
          entry.lastModified = await fs_async
            .stat(entry.fullPath)
            .then((stat) => stat.mtime)
            .catch(() => null);
          if (argv.uselocaldb)
            entry.mediaStatus = mediaStatus.find((el) => el.file_name == item);

          content.push(entry);
        }
      }
    } catch (exc) {
      console.log(exc);
    }
  }
  return content;
}

app.get("/api/v1/status", async (req, res) => {
  try {
    return res.json(await getMPVProps());
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
MEDIA CONTROLS
*/

app.post("/api/v1/controls/play-pause", async (req, res) => {
  try {
    await mpv.togglePause();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/controls/stop", async (req, res) => {
  try {
    await mpv.stop();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

async function playlistPrev(req, res) {
  try {
    await mpv.prev();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
}

async function playlistNext(req, res) {
  try {
    await mpv.next();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
}

app.post("/api/v1/controls/prev", playlistPrev);
app.post("/api/v1/playlist/prev", playlistPrev);

app.post("/api/v1/controls/next", playlistNext);
app.post("/api/v1/playlist/next", playlistNext);

app.post("/api/v1/controls/fullscreen", async (req, res) => {
  try {
    await mpv.toggleFullscreen();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/controls/volume/:value", async (req, res) => {
  try {
    await mpv.volume(req.params.value);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/controls/mute", async (req, res) => {
  try {
    await mpv.toggleMute();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/controls/seek", async (req, res) => {
  try {
    if (!req.body.flag) req.body.flag = "relative";
    await mpv.seek(req.body.target, req.body.flag);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
  TRACKS
*/
app.get("/api/v1/tracks", async (req, res) => {
  try {
    return res.json(await getTracks());
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
  AUDIO TRACKS
*/
app.post("/api/v1/tracks/audio/reload/:id", async (req, res) => {
  try {
    await mpv.selectAudioTrack(req.params.id);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/tracks/audio/cycle", async (req, res) => {
  try {
    await mpv.cycleAudioTracks();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/tracks/audio/add", async (req, res) => {
  try {
    if (!req.body.flag) req.body.flag = "select";
    await mpv.addAudioTrack(req.body.filename, req.body.flag);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/tracks/audio/timing/:seconds", async (req, res) => {
  try {
    await mpv.adjustAudioTiming(req.query.seconds);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
  SUB TRACKS
*/
app.post("/api/v1/tracks/sub/timing/:seconds", async (req, res) => {
  try {
    await mpv.adjustSubtitleTiming(req.query.seconds);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

// TODO Ass override
// TODO: Allow font-size if not ASS/SSA
app.post("/api/v1/tracks/sub/font-size/:size", async (req, res) => {
  try {
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/tracks/sub/toggle-visibility", async (req, res) => {
  try {
    await mpv.toggleSubtitleVisibility();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/sub/add", async (req, res) => {
  try {
    // TODO: title, lang
    if (!req.body.flag) req.body.flag = "select";
    await mpv.addSubtitles(req.body.filename, req.body.flag);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
  PLAYLIST
*/
app.get("/api/v1/playlist", async (req, res) => {
  try {
    return res.json(await getPlaylist());
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/playlist", async (req, res) => {
  try {
    console.log(req.body);
    if (!req.body.flag) req.body.flag = "append-play";
    if (
      !stringIsAValidUrl(req.body.filename) &&
      fs.lstatSync(req.body.filename).isDirectory()
    ) {
      for (const item of await fs_async.readdir(req.body.filename)) {
        let type = detectFileType(path.extname(item));
        if (type === "video" || type == "audio") {
          await mpv.load(item, "append-play");
        }
      }
    } else {
      await mpv.load(req.body.filename, req.body.flag);
      if (req.body.seekTo) {
        await mpv.seek(req.body.seekTo, "absolute");
      }
    }
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.delete("/api/v1/playlist/remove/:index", async (req, res) => {
  try {
    await mpv.playlistRemove(req.params.index);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/playlist/move", async (req, res) => {
  try {
    if (!req.query.fromIndex)
      return res
        .status(400)
        .json({ message: "fromIndex query param required!" });
    if (!req.query.toIndex)
      return res.status(400).json({ message: "toIndex query param required!" });

    await mpv.playlistMove(req.query.fromIndex, req.query.toIndex);
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/playlist/play/:index", async (req, res) => {
  try {
    await mpv.command("playlist-play-index", [req.params.index]);
    await mpv.play();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/playlist/clear", async (req, res) => {
  try {
    await mpv.clearPlaylist();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.post("/api/v1/playlist/shuffle", async (req, res) => {
  try {
    await mpv.shuffle();
    return res.json({ message: "success" });
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

/*
  FILE BROWSER
*/

app.get("/api/v1/filebrowser/paths", async (req, res) => {
  try {
    return res.json(FILEBROWSER_PATHS);
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

// TODO: Change API spec it's wrong way to do this
app.post("/api/v1/filebrowser/browse", async (req, res) => {
  try {
    console.log(req.body);
    let p = req.body.path;
    // Find FILEBROWSER_PATH entry
    if (!p)
      return res
        .status(400)
        .json({ message: "path missing from request data!" });

    console.log(p);
    let fbe = FILEBROWSER_PATHS.find((el) => {
      console.log(el);
      return p.includes(el.path);
    });

    if (!fbe)
      return res
        .status(400)
        .send({ message: "Path not exists on filebrowserpaths!" });

    if (!fs.existsSync(p))
      return res.status(404).send({ message: "Path not exists!" });

    // Get files from directory
    let retval = {};
    retval.content = await getDirectoryContents(p);
    retval.dirname = path.basename(p);
    retval.prevDir = path.resolve(p, "..");
    retval.cwd = p;

    // Sort content firstly by priority and alphabet order.
    retval.content.sort((a, b) => {
      return (
        a.priority - b.priority ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
    });

    return res.json(retval);
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ message: exc });
  }
});

app.get("/fileman", async (req, res) => {
  try {
    let qpath = req.query.path;
    let qcollection = req.query.collection;

    let retval = {};
    retval.content = [];

    if (qpath) {
      if (!fs.existsSync(qpath))
        return res.status(404).send("Path not exists!");
      retval.content = await getDirectoryContents(qpath);
      retval.dirname = path.basename(qpath);
      retval.prevDir = path.resolve(qpath, "..");
      retval.cwd = qpath;
    } else if (qcollection) {
      // Get collection
      let collection = await getCollections(qcollection);
      if (!collection) return res.status(404).send("Collection not exists!");
      await Promise.all(
        collection.paths.map(async (item) => {
          if (fs.existsSync(item.path)) {
            const dir = await getDirectoryContents(item.path);
            retval.content = [...retval.content, ...dir];
          } else {
            console.log(`Path not exists ${item.path}`);
          }
        })
      );
      retval.collection_id = qcollection;
    } else {
      qpath = os.homedir();
      content = await getDirectoryContents(qpath);
      retval.dirname = path.basename(qpath);
      retval.prevDir = path.resolve(qpath, "..");
      retval.cwd = qpath;
      retval.content = content;
    }
    retval.content.sort((a, b) => {
      return (
        a.priority - b.priority ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
    });

    return res.json(retval);
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ error: exc });
  }
});

app.get("/collections/:id?", async (req, res) => {
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });

    if (req.params.id) {
      return res.json(await getCollections(req.params.id));
    } else {
      return res.json(await getCollections());
    }
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ error: exc });
  }
});

app.post("/collections/", async (req, res) => {
  // TODO Some validation.
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });
    const collection = await createCollection(req.body);
    return res.json(collection);
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ error: exc });
  }
});

app.patch("/collections/:collection_id/", async (req, res) => {
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });
    return res.json(await updateCollection(req.params.collection_id, req.body));
  } catch (exc) {
    console.log(exc);
    return res.status(500).json({ error: exc });
  }
});
app.delete("/collections/:collection_id/", async (req, res) => {
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });
    const collection_id = req.params.collection_id;
    deleteCollection(collection_id);
    return res.json({});
  } catch (exc) {
    return res.status(500).json({ error: exc });
  }
});

app.post("/collections/:collection_id/entries/", async (req, res) => {
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });
    const collection_entry = await createCollectionEntry(
      req.params.collection_id,
      req.body
    );
    return res.json(collection_entry);
  } catch (exc) {
    return res.status(500).json({ error: exc });
  }
});

app.delete("/collections/entries/:id", async (req, res) => {
  try {
    if (!argv.uselocaldb)
      return res.status(400).json({
        message: "mpvremote-uselocaldb disabled!",
      });
    deleteCollectionEntry(req.params.id);
    return res.json({});
  } catch (exc) {
    return res.status(500).json({ error: exc });
  }
});

mpv.on("status", async (status) => {
  try {
    console.log(status);
    switch (status.property) {
      case "pause":
        await mpv.command("show-text", [status.value ? "Pause" : "Play"]);
        break;
      case "volume":
        await mpv.command("show-text", [`Volume: ${status.value}%`]);
        break;
      case "mute":
        let volume = await mpv.getProperty("volume");
        await mpv.command("show-text", [
          status.value ? "Mute" : `Volume ${volume}`,
        ]);
        break;
      case "playlist-count":
      case "playlist-pos":
        break;
      case "path":
        playerData = await getMPVProps();
        if (status.value) {
          // Reset subdelay to 0
          await mpv.setProperty("sub-delay", 0);
          // Also reset audio delay to 0
          await mpv.adjustAudioTiming(0);

          await mpv.command("show-text", [
            `Playing: ${playerData["media-title"] || playerData.filename}`,
          ]);
        }
        break;
    }
  } catch (exc) {
    console.log(exc);
  }
});

mpv.on("seek", async (data) => {
  console.log(data);
  await mpv.command("show-text", [`Seek: ${formatTime(data.end)}`]);
});

function formatTime(param) {
  var sec_num = parseInt(param);
  var hours = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - hours * 3600) / 60);
  var seconds = sec_num - hours * 3600 - minutes * 60;

  if (hours < 10) {
    hours = "0" + hours;
  }
  if (minutes < 10) {
    minutes = "0" + minutes;
  }
  if (seconds < 10) {
    seconds = "0" + seconds;
  }
  return hours + ":" + minutes + ":" + seconds;
}

function handle(promise) {
  return promise
    .then((data) => [data, undefined])
    .catch((error) => Promise.resolve([undefined, error]));
}

async function getTracks() {
  const count = await mpv.getProperty("track-list/count");
  let tracks = [];
  for (let i = 0; i < count; i++) {
    try {
      let track = {
        index: i,
        id: await handle(mpv.getProperty(`track-list/${i}/id`)).then(
          (resp) => resp[0]
        ),
        type: await handle(mpv.getProperty(`track-list/${i}/type`)).then(
          (resp) => resp[0]
        ),
        selected: await handle(
          mpv.getProperty(`track-list/${i}/selected`)
        ).then((resp) => resp[0]),
        codec: await handle(mpv.getProperty(`track-list/${i}/codec`)).then(
          (resp) => resp[0]
        ),
      };
      // Get specific stuff
      if (track.type === "video") {
        track["demux-w"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-w`)
        ).then((resp) => resp[0]);
        track["demux-h"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-h`)
        ).then((resp) => resp[0]);
      } else if (track.type === "audio") {
        track["demux-channel-count"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-channel-count`)
        ).then((resp) => resp[0]);
        track["demux-channels"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-channels`)
        ).then((resp) => resp[0]);
        track["demux-samplerate"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-samplerate`)
        ).then((resp) => resp[0]);
        track["demux-bitrate"] = await handle(
          mpv.getProperty(`track-list/${i}/demux-bitrate`)
        ).then((resp) => resp[0]);
        track.lang = await handle(mpv.getProperty(`track-list/${i}/lang`)).then(
          (resp) => resp[0]
        );
        track["external-filename"] = await handle(
          mpv.getProperty(`track-list/${i}/external-filename`)
        ).then((resp) => resp[0]);
      } else if (track.type === "sub") {
        track.lang = await handle(mpv.getProperty(`track-list/${i}/lang`)).then(
          (resp) => resp[0]
        );
        track["external-filename"] = await handle(
          mpv.getProperty(`track-list/${i}/external-filename`)
        ).then((resp) => resp[0]);
      }

      tracks.push(track);
    } catch (exc) {
      console.log(exc);
    }
  }
  return tracks;
}

async function getPlaylist() {
  const count = await mpv.getProperty("playlist-count");
  let playlist = [];
  for (let i = 0; i < count; i++) {
    try {
      let item = {
        index: i,
        id: await handle(mpv.getProperty(`playlist/${i}/id`)).then(
          (resp) => resp[0]
        ),
        filePath: await handle(mpv.getProperty(`playlist/${i}/filename`)).then(
          (resp) => resp[0]
        ),
        current: await handle(mpv.getProperty(`playlist/${i}/current`)).then(
          (resp) => resp[0]
        ),
        title: await handle(mpv.getProperty(`playlist/${i}/title`)).then(
          (resp) => resp[0]
        ),
      };

      if (item.filePath) item.filename = path.basename(item.filePath);
      playlist.push(item);
    } catch (exc) {
      console.log(exc);
    }
  }
  return playlist;
}

async function getChapters() {
  const count = await mpv.getProperty("chapter-list/count");
  let chapters = [];
  for (let i = 0; i < count; i++) {
    chapters.push({
      title: await handle(mpv.getProperty(`chapter-list/${i}/title`)).then(
        (resp) => resp[0]
      ),
      time: await handle(mpv.getProperty(`chapter-list/${i}/time`)).then(
        (resp) => resp[0]
      ),
    });
  }
  return chapters;
}

// TODO Metadata
async function getMetaData() {
  const count = await mpv.getProperty("metadata/list/count");
  let metadata = {};

  for (let i = 0; i < count; i++) {
    const key = await handle(mpv.getProperty(`metadata/${i}/key`)).then(
      (resp) => resp[0]
    );

    if (key) {
      const value = await handle(mpv.getProperty(`metadata/${i}/value`)).then(
        (resp) => resp[0]
      );

      if (value) {
        metadata[key] = value;
      }
    }
  }
  return metadata;
}
async function getMPVProps() {
  let props = {
    pause: false,
    mute: false,
    filename: null,
    duration: 0,
    position: 0,
    remaining: 0,
    "media-title": null,
    playlist: [],
    chapter: 0,
    "chapter-list": [],
    volume: 0,
    fullscreen: false,
    speed: 1,
    "sub-delay": 0,
    "track-list": [],
  };

  try {
    props.pause = (await mpv.getProperty("pause")) || false;
    props.volume = (await mpv.getProperty("volume")) || 100;
    props.mute = (await mpv.getProperty("mute")) || false;
    // File related data, only send back if available.
    props.filename = await mpv.getProperty("filename");
    props.duration = (await mpv.getProperty("duration")) || 0.0;
    props.position = (await mpv.getProperty("time-pos")) || 0.0;
    props.remaining = (await mpv.getProperty("time-remaining")) || 0.0;
    props.fullscreen = (await mpv.getProperty("fullscreen")) || false;

    props["media-title"] = await mpv.getProperty("media-title");
    props.playlist = (await getPlaylist()) || [];

    props.chapter = (await mpv.getProperty("chapter")) || 0;
    props["chapter-list"] = (await getChapters()) || [];
    props.speed = await mpv.getProperty("speed");
    props["sub-delay"] = (await mpv.getProperty("sub-delay")) || 0;
    props.metadata = (await getMetaData()) || {};
    props["track-list"] = (await getTracks()) || [];
  } catch (exc) {
    if (exc.errmessage != "property unavailable") {
      console.log(exc);
    }
  }

  return props;
}

app.listen(SERVER_PORT, () => {
  console.log(`listening on ${SERVER_IP}:${SERVER_PORT}`);
});

async function main() {
  try {
    await mpv.start();

    if (argv.uselocaldb) await initDB();
    await mpv.command("show-text", [
      `Remote access on: ${SERVER_IP}:${SERVER_PORT}`,
      5000,
    ]);
  } catch (error) {
    // handle errors here
    console.log(error);
  }
}

process.on("unhandledRejection", (error) => {
  // Will print "unhandledRejection err is not defined"
  console.log("unhandledRejection", JSON.stringify(error));
});

main();
