const express = require("express");
const admin = require("firebase-admin");
const multer = require("multer");

// Initialize Firebase Admin SDK
const serviceAccount = require("./admin.json"); // Replace with your service account key file
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "prabal-rural-empower.firebasestorage.app", // Replace with your Firebase Storage bucket URL
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

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
    res.status(401).send("Unauthorized");
  }
}

// Add User
app.post("/add_user", async (req, res) => {
  const { uname } = req.body;
  if (!uname) return res.status(400).send("Username is required");
  try {
    await db.collection("users").doc(uname).set({ uname, rooms: [] });
    res.status(201).send("User added");
  } catch (error) {
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
    res.status(500).send("Error joining room");
  }
});

// Upload Post
app.post("/upload", authenticate, upload.single("file"), async (req, res) => {
  const { code, content } = req.body;
  const file = req.file;
  if (!code || !content || !file)
    return res.status(400).send("All fields are required");
  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
      return res.status(403).send("Forbidden");
    }

    const fileName = `${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);
    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    blobStream.on("error", (error) => {
      res.status(500).send("Error uploading file");
    });

    blobStream.on("finish", async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`;
      await db.collection("rooms").doc(code).collection("posts").add({
        content,
        fileUrl: publicUrl,
        author: req.user.email,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.status(201).send("Post uploaded");
    });

    blobStream.end(file.buffer);
  } catch (error) {
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
    res.status(500).send("Error creating announcement");
  }
});
app.post("/getAnnouncements", authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send("Room code is required");
  try {
    const userRef = db.collection("users").doc(req.user.email);
    const userDoc = await userRef.get();
    if (!userDoc.exists || !userDoc.data().rooms.includes(code)) {
      return res.status(403).send("Forbidden");
    }

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
    res.status(500).send("Error fetching announcements");
  }
});
const PORT = 5060;
app.listen(PORT, (err) => {
  if (err) process.exit(1);
  console.log(`server running on port ${PORT}`);
});
