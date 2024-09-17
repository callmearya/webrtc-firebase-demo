import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD1b7InCyJf03f82MBrFCXNd_1lir3e1",
  authDomain: "lil-testing.firebaseapp.com",
  projectId: "lil-testing",
  storageBucket: "lil-testing.appspot.com",
  messagingSenderId: "309006701748",
  appId: "1:309006701748:web:2cfa73093e14fbcc2af3e1"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = new MediaStream();  // Empty stream for remote audio and video

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// 1. Setup media sources
webcamButton.onclick = async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log('Got local stream', localStream);

    // Mute the local audio so you don't hear yourself
    localStream.getAudioTracks().forEach(track => {
      track.enabled = false;
      console.log('Disabling local audio track for self');
    });

    // Push tracks from local stream to the peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
      console.log(`Added track: ${track.kind}`);
    });

    // Play local video stream
    webcamVideo.srcObject = localStream;

    // Handle remote stream tracks
    pc.ontrack = (event) => {
      console.log('Received remote stream tracks:', event.streams[0]);
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
        console.log(`Remote track added: ${track.kind}`);
      });
      remoteVideo.srcObject = remoteStream;  // Set remote stream to the remote video element
    };

    callButton.disabled = false;
    answerButton.disabled = false;
    webcamButton.disabled = true;
  } catch (error) {
    console.error('Error accessing media devices.', error);
  }
};

// 2. Create an offer
callButton.onclick = async () => {
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get ICE candidates for the caller, save to Firestore
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      offerCandidates.add(event.candidate.toJSON());
      console.log('Added local ICE candidate:', event.candidate);
    }
  };

  // Create an offer and set it as the local description
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });
  console.log('Created and sent offer:', offer);

  // Listen for the remote answer and set it as the remote description
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
      console.log('Set remote description from answer:', answerDescription);
    }
  });

  // When answered, listen for remote ICE candidates
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
        console.log('Added remote ICE candidate:', candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  // Get ICE candidates for the answerer and save to Firestore
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      answerCandidates.add(event.candidate.toJSON());
      console.log('Added answerer ICE candidate:', event.candidate);
    }
  };

  const callData = (await callDoc.get()).data();
  const offerDescription = callData.offer;

  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));
  console.log('Set remote description from offer:', offerDescription);

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    sdp: answerDescription.sdp,
    type: answerDescription.type,
  };

  await callDoc.update({ answer });
  console.log('Created and sent answer:', answer);

  // Listen for remote ICE candidates
  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
        console.log('Added remote ICE candidate:', candidate);
      }
    });
  });
};
