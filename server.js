const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Initialize Firebase Admin SDK
const serviceAccount = require("./admin.json"); // Replace with your service account key file
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "prabal-rural-empower.firebasestorage.app", // Replace with your Firebase Storage bucket URL
});

const db = admin.firestore();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(cors({ origin: "*" }));
app.use("/uploads", express.static(UPLOAD_DIR));

// Middleware to verify Firebase ID Token
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized");
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(401).send("Unauthorized");
  }
}
app.get("/health", async (req, res) => {
  res.send("healthy");
});
// Add User
app.post("/add_user", async (req, res) => {
  const { uname } = req.body;
  if (!uname) return res.status(400).send("Username is required");
  try {
    await db.collection("users").doc(uname).set({ uname, rooms: [] });
    res.status(201).send("User added");
  } catch (error) {
    console.error("Add User Error:", error);
    res.status(500).send("Error adding user");
  }
});

// Create Room
app.post("/create_room", async (req, res) => {
  const { title, teacher, description } = req.body;
  if (!title || !teacher || !description)
    return res.status(400).send("All fields are required");
  try {
    const roomRef = await db
      .collection("rooms")
      .add({ title, teacher, description });
    res.status(201).send({ code: roomRef.id });
  } catch (error) {
    console.error("Create Room Error:", error);
    res.status(500).send("Error creating room");
  }
});

// Join Room
app.post("/join_room", authenticate, async (req, res) => {
  const { uname, code } = req.body;
  if (req.user.email !== uname) return res.status(403).send("Forbidden");
  try {
    const userRef = db.collection("users").doc(uname);
    await userRef.update({
      rooms: admin.firestore.FieldValue.arrayUnion(code),
    });
    res.status(200).send("Joined room");
  } catch (error) {
    console.error("Join Room Error:", error);
    res.status(500).send("Error joining room");
  }
});

app.post("/upload", authenticate, upload.single("file"), async (req, res) => {
  const { code, content } = req.body;
  const file = req.file;

  if (!code || !content || !file) {
    return res.status(400).send("All fields are required");
  }

  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
      return res.status(403).send("Forbidden");
    }

    // Create unique filename
    const fileName = `${Date.now()}_${file.originalname}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Save file to local filesystem
    fs.writeFileSync(filePath, file.buffer);

    const localFileUrl = `/uploads/${fileName}`;

    await db.collection("rooms").doc(code).collection("posts").add({
      content,
      fileUrl: localFileUrl,
      author: req.user.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).send("Post uploaded");
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).send("Error uploading post");
  }
});

// Get Posts
app.post("/posts", authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send("Room code is required");
  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
      return res.status(403).send("Forbidden");
    }

    const postsSnapshot = await db
      .collection("rooms")
      .doc(code)
      .collection("posts")
      .orderBy("timestamp", "desc")
      .get();

    const posts = postsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json(posts);
  } catch (error) {
    console.error("Fetch Posts Error:", error);
    res.status(500).send("Error fetching posts");
  }
});

// Announce
app.post("/announce", authenticate, async (req, res) => {
  const { code, title, description } = req.body;
  if (!code || !title || !description)
    return res.status(400).send("All fields are required");

  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
      console.log(!userDoc.exists, !userDoc.data().rooms.includes(code));
      return res.status(403).send("Forbidden");
    }

    await db.collection("rooms").doc(code).collection("announcements").add({
      title,
      description,
      author: req.user.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(201).send("Announcement created");
  } catch (error) {
    console.error("Announce Error:", error);
    res.status(500).send("Error creating announcement");
  }
});

// Get Announcements
app.post("/getAnnouncements", authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send("Room code is required");

  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    // if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
    //   return res.status(403).send("Forbidden");
    // }

    const announcementsSnapshot = await db
      .collection("rooms")
      .doc(code)
      .collection("announcements")
      .orderBy("timestamp", "desc")
      .get();

    const announcements = announcementsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(announcements);
  } catch (error) {
    console.error("Fetch Announcements Error:", error);
    res.status(500).send("Error fetching announcements");
  }
});

// Get all rooms the user has joined
app.get("/roomsof/:uname", async (req, res) => {
  const uname = req.params.uname;
  if (!uname) return res.status(400).send("Username is required");

  try {
    const userRef = db.collection("users").doc(uname);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send("User not found");
    }

    const roomCodes = userDoc.data().rooms || [];

    if (roomCodes.length === 0) {
      return res.status(200).json([]);
    }

    const roomFetches = roomCodes.map((code) =>
      db
        .collection("rooms")
        .doc(code)
        .get()
        .then((doc) => {
          if (doc.exists) {
            return { id: doc.id, ...doc.data() };
          }
          return null;
        })
    );

    const rooms = (await Promise.all(roomFetches)).filter(Boolean);
    res.status(200).json(rooms);
  } catch (error) {
    console.error("Get My Rooms Error:", error);
    res.status(500).send("Error fetching joined rooms");
  }
});

app.get("/room/:code", async (req, res) => {
  const { code } = req.params;

  try {
    const roomDoc = await db.collection("rooms").doc(code).get();

    if (!roomDoc.exists) {
      return res.status(404).send("Room not found");
    }

    const data = roomDoc.data();
    res.json({
      title: data.title,
      description: data.description,
      teacher: data.teacher,
    });
  } catch (error) {
    console.error("Error fetching room:", error);
    res.status(500).send("Error fetching room");
  }
});

const PORT = 61060;
app.listen(PORT, (err) => {
  if (err) process.exit(1);
  console.log(`🚀 Server running on port ${PORT}`);
});
