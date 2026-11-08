
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dimond-topup-df909-default-rtdb.firebaseio.com"
});

async function makeAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.log("ব্যবহার: node set_admin.js admin@email.com");
    process.exit(1);
  }

  try {
    const user = await admin.auth().getUserByEmail(email);

    await admin.auth().setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      admin: true
    });

    console.log("Admin সফলভাবে তৈরি হয়েছে!");
    console.log("Email:", user.email);
    console.log("UID:", user.uid);

  } catch (error) {
    console.error("Admin তৈরিতে সমস্যা:", error.message);
    process.exitCode = 1;
  } finally {
    await admin.app().delete();
  }
}

makeAdmin();
