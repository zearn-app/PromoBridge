// Client-side Firebase config. These values are PUBLIC by design (they
// identify your project, they are not secrets) — safe to ship in the
// bundle. Get them from Firebase Console > Project Settings > General >
// "Your apps" > SDK setup and configuration.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const firebaseConfig = {
  apiKey: "AIzaSyAbYt_z5GaqOTcVlz3FRjssTwC7Uzv_MdA",
  authDomain: "information-b9593.firebaseapp.com",
  projectId: "information-b9593",
  storageBucket: "information-b9593.firebasestorage.app",
  messagingSenderId: "767588407430",
  appId: "1:767588407430:web:7f1797ffef8dc53d51d907",
  measurementId: "G-3NFG7X1C2J"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
};
