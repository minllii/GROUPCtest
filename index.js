const express = require('express');
const app = express();
const port = process.env.PORT || 4000;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Middleware to parse JSON in request body
app.use(express.json());

const uri = "mongodb+srv://7naa:hurufasepuluhkali@cluster0.4oeznz2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let selectedMap = null;
let playerPosition = null;

// Function to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401); // Unauthorized if no token

  jwt.verify(token, "hurufasepuluhkali", (err, decoded) => {
    if (err) return res.sendStatus(403); // Forbidden if token invalid
    req.identity = decoded; // Attach the decoded token for further use
    next();
  });
}

// Middleware to verify if the user is admin
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Extract token

  if (!token) return res.sendStatus(401); // Unauthorized if no token

  jwt.verify(token, "hurufasepuluhkali", (err, decoded) => {
    if (err) return res.sendStatus(403); // Forbidden if token invalid
    if (decoded.username !== "admin") {
      return res.status(403).send("Access restricted to admin only.");
    }
    next(); // Proceed if the user is admin
  });
}

// Initialize admin user if not already in the database
async function initializeAdmin() {
  const adminUsername = "admin";
  const adminPassword = "admin"; // Default admin password
  const hashedPassword = bcrypt.hashSync(adminPassword, 15);

  const existingAdmin = await client.db("user").collection("userdetail").findOne({ username: adminUsername });

  if (!existingAdmin) {
    await client.db("user").collection("userdetail").insertOne({
      username: adminUsername,
      password: hashedPassword,
      name: "Administrator",
      email: "admin@example.com",
    });
    console.log("Admin user initialized.");
  } else {
    console.log("Admin user already exists.");
  }
}

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");

    // Initialize the admin user
    await initializeAdmin();
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
  }
}

// User registration with duplicate username prevention
app.post('/user', async (req, res) => {
  try {
    const { username, password, name, email } = req.body;

    // Ensure all required fields are provided
    if (!username || !password || !name || !email) {
      return res.status(400).send("All fields are required.");
    }

    // Check if username already exists
    const existingUser = await client.db("user").collection("userdetail").findOne({ username });
    if (existingUser) {
      return res.status(400).send("Username already exists. Please choose a different username.");
    }

    // Hash the password
    const hash = bcrypt.hashSync(password, 15);

    // Insert the new user
    await client.db("user").collection("userdetail").insertOne({
      username,
      password: hash,
      name,
      email,
    });

    res.status(201).send("User registered successfully.");
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).send("Username already exists. Please choose a different username.");
    } else {
      console.error("Error during registration:", error);
      res.status(500).send("Internal server error.");
    }
  }
});

// User login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).send("Missing username or password.");
    }

    const user = await client.db("user").collection("userdetail").findOne({ username });

    if (!user) {
      return res.status(401).send("Username not found.");
    }

    const passwordMatch = bcrypt.compareSync(password, user.password);

    if (!passwordMatch) {
      return res.status(401).send("Wrong password! Try again.");
    }

    const token = jwt.sign(
      { _id: user._id, username: user.username, name: user.name },
      'hurufasepuluhkali'
    );

    // Respond with both user ID and token
    res.status(200).send({
      id: user._id.toString(),  // Ensure the ID is converted to string if it's an ObjectId
      token: token,
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).send("Internal server error.");
  }
});

// Get user profile (Admin Only)
app.get('/user/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const user = await client.db("user").collection("userdetail").findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!user) {
      return res.status(404).send("User not found.");
    }

    res.send(user);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).send("Internal server error.");
  }
});

// Delete user account (Admin Only)
app.delete('/user/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await client.db("user").collection("userdetail").deleteOne({
      _id: new ObjectId(req.params.id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send("User not found.");
    }

    res.send("User deleted successfully.");
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).send("Internal server error.");
  }
});

// Start server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

// Connect to MongoDB
run().catch(console.dir);

// Choose map
app.post('/choose-map', (req, res) => {
  const selectedMapName = req.body.selectedMap;

  function mapJsonPathExists(mapPath) {
    try {
      fs.accessSync(mapPath, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  const mapJsonPath = `./${selectedMapName}.json`;

  if (mapJsonPathExists(mapJsonPath)) {
    const mapData = require(mapJsonPath);
    selectedMap = selectedMapName; // Store the selected map globally
    playerPosition = mapData.playerLoc; // Set initial player position
    const room1Message = mapData.map.room1.message;

    res.send(`You choose ${selectedMapName}. Let's start playing!\n\nRoom 1 Message:\n${room1Message}`);
  } else {
    res.status(404).send(`Map "${selectedMapName}" not found.`);
  }
});

// Move player
app.patch('/move', (req, res) => {
  const direction = req.body.direction;

  if (!selectedMap) {
    res.status(400).send("No map selected.");
    return;
  }

  const mapData = require(`./${selectedMap}.json`);
  const currentRoom = mapData.map[playerPosition];

  const nextRoom = currentRoom[direction];
  if (!nextRoom) {
    res.status(400).send(`Invalid direction: ${direction}`);
    return;
  }

  const nextRoomMessage = mapData.map[nextRoom].message;
  playerPosition = nextRoom;

  res.send(`You moved ${direction}. ${nextRoomMessage}`);
});
