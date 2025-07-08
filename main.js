import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  const [editUserName, setEditUserName] = useState('');
  const [isEditingUserName, setIsEditingUserName] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Helper function to format date for display
  const formatDateForDisplay = (dateKey) => {
    if (dateKey === 'pending') {
      return 'Mengirim...';
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const date = new Date(dateKey);

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = date.toLocaleDateString('id-ID', options);

    const todayDateString = today.toISOString().split('T')[0];
    const yesterdayDateString = yesterday.toISOString().split('T')[0];

    if (dateKey === todayDateString) {
      return 'Hari Ini';
    } else if (dateKey === yesterdayDateString) {
      return 'Kemarin';
    } else {
      return formattedDate;
    }
  };

  // Initialize Firebase and set up authentication
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const authenticate = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(firebaseAuth, initialAuthToken);
          } else {
            await signInAnonymously(firebaseAuth);
          }
        } catch (authError) {
          console.error("Firebase authentication error:", authError);
          setError("Gagal mengautentikasi pengguna. Silakan coba lagi.");
        }
      };

      authenticate();

      const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
        if (user) {
          setUserId(user.uid);
          let storedUserName = localStorage.getItem(`chatUserName_${user.uid}`);
          if (!storedUserName) {
            storedUserName = `Pengguna${Math.floor(Math.random() * 10000)}`;
            localStorage.setItem(`chatUserName_${user.uid}`, storedUserName);
          }
          setUserName(storedUserName);
          setEditUserName(storedUserName);
        } else {
          setUserId(null);
          setUserName('');
          setEditUserName('');
        }
        setIsLoading(false);
      });

      return () => unsubscribeAuth();
    } catch (initError) {
      console.error("Firebase initialization error:", initError);
      setError("Gagal menginisialisasi Firebase. Periksa konfigurasi Anda.");
      setIsLoading(false);
    }
  }, []);

  // Fetch messages from Firestore in real-time and group them by date
  useEffect(() => {
    if (db && userId) {
      const messagesCollectionRef = collection(db, `artifacts/${appId}/public/data/messages`);
      const q = query(messagesCollectionRef, orderBy('timestamp', 'asc'));

      const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const messagesList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        const grouped = {};
        messagesList.forEach(msg => {
          if (msg.timestamp) {
            const date = new Date(msg.timestamp.toDate());
            const dateKey = date.toISOString().split('T')[0];
            if (!grouped[dateKey]) {
              grouped[dateKey] = [];
            }
            grouped[dateKey].push(msg);
          } else {
            const pendingDateKey = 'pending';
            if (!grouped[pendingDateKey]) {
              grouped[pendingDateKey] = [];
            }
            grouped[pendingDateKey].push(msg);
          }
        });

        const groupedMessagesArray = Object.keys(grouped).map(dateKey => ({
          dateKey: dateKey,
          messages: grouped[dateKey]
        }));

        groupedMessagesArray.sort((a, b) => {
          if (a.dateKey === 'pending') return -1;
          if (b.dateKey === 'pending') return 1;
          return a.dateKey.localeCompare(b.dateKey);
        });

        setMessages(groupedMessagesArray);
        setTimeout(scrollToBottom, 100);
      }, (snapshotError) => {
        console.error("Error fetching messages:", snapshotError);
        setError("Gagal memuat pesan. Silakan coba lagi.");
      });

      return () => unsubscribeSnapshot();
    }
  }, [db, userId]);

  // Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  };

  // Clear selected file
  const handleClearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle sending a new message or file
  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!newMessage.trim() && !selectedFile) {
      setError("Pesan atau file tidak boleh kosong.");
      return;
    }
    if (!db || !userId || !userName) {
      setError("Tidak dapat mengirim pesan: autentikasi belum selesai atau database tidak tersedia.");
      return;
    }

    let messagePayload = {
      timestamp: serverTimestamp(),
      userId: userId,
      userName: userName,
    };

    if (newMessage.trim()) {
      messagePayload.text = newMessage.trim();
    }

    if (selectedFile) {
      if (selectedFile.type.startsWith('image/')) {
        const filename = selectedFile.name;
        const width = 200;
        const height = 150;
        const bgColor = 'cccccc';
        const textColor = '333333';
        const text = encodeURIComponent(filename.substring(0, 20) + (filename.length > 20 ? '...' : ''));
        messagePayload.fileType = 'image';
        messagePayload.fileName = filename;
        messagePayload.fileUrl = `https://placehold.co/${width}x${height}/${bgColor}/${textColor}?text=${text}`;
      } else {
        messagePayload.fileType = selectedFile.type;
        messagePayload.fileName = selectedFile.name;
      }
    }

    try {
      await addDoc(collection(db, `artifacts/${appId}/public/data/messages`), messagePayload);
      setNewMessage('');
      handleClearFile();
      setError(null);
    } catch (e) {
      console.error("Error adding message/file: ", e);
      setError("Gagal mengirim pesan atau file. Silakan coba lagi.");
    }
  };

  // Handle click to edit username
  const handleEditUserNameClick = () => {
    setIsEditingUserName(true);
    setEditUserName(userName);
  };

  // Handle saving new username
  const handleSaveUserName = () => {
    if (editUserName.trim() && userId) {
      setUserName(editUserName.trim());
      localStorage.setItem(`chatUserName_${userId}`, editUserName.trim());
      setIsEditingUserName(false);
      setError(null);
    } else {
      setError("Nama pengguna tidak boleh kosong.");
    }
  };

  // Handle canceling username edit
  const handleCancelEditUserName = () => {
    setIsEditingUserName(false);
    setEditUserName(userName);
    setError(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        Memuat aplikasi obrolan...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-inter">
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; }
        `}
      </style>
      {/* Tailwind CSS CDN */}
      <script src="https://cdn.tailwindcss.com"></script>
      {/* Font Awesome for icons */}
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css"></link>

      {/* Header */}
      <header className="bg-gray-800 p-4 shadow-md flex justify-between items-center rounded-b-lg">
        <h1 className="text-3xl font-bold text-blue-400">Obrolan Real-time</h1>
        <div className="text-sm text-gray-400 flex items-center space-x-2">
          <div>
            <p>ID Pengguna: <span className="font-mono text-blue-300 break-all">{userId}</span></p>
            <div className="flex items-center space-x-2">
              <p>Nama Pengguna:</p>
              {isEditingUserName ? (
                <>
                  <input
                    type="text"
                    value={editUserName}
                    onChange={(e) => setEditUserName(e.target.value)}
                    className="p-1 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 w-32"
                  />
                  <button
                    onClick={handleSaveUserName}
                    className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-md text-xs transition duration-200"
                  >
                    Simpan
                  </button>
                  <button
                    onClick={handleCancelEditUserName}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded-md text-xs transition duration-200"
                  >
                    Batal
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-blue-300">{userName}</span>
                  <button
                    onClick={handleEditUserNameClick}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded-md text-xs transition duration-200"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Error Message Display */}
      {error && (
        <div className="bg-red-800 text-white p-3 m-4 rounded-lg text-center">
          {error}
        </div>
      )}

      {/* Chat Messages Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <p className="text-center text-gray-500">Belum ada pesan. Mulai obrolan!</p>
        )}
        {messages.map((dayGroup, index) => (
          <div key={dayGroup.dateKey || `day-group-${index}`}>
            {/* Date Header */}
            <div className="text-center my-4">
              <span className="inline-block bg-gray-700 text-gray-300 text-xs px-3 py-1 rounded-full shadow-md">
                {formatDateForDisplay(dayGroup.dateKey)}
              </span>
            </div>
            {/* Messages for this day */}
            {dayGroup.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.userId === userId ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg p-3 rounded-lg shadow-md ${
                    msg.userId === userId
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-gray-700 text-gray-100 rounded-bl-none'
                  }`}
                >
                  <p className="font-semibold text-sm mb-1">
                    {msg.userId === userId ? 'Anda' : msg.userName || 'Pengguna Anonim'}
                  </p>
                  {msg.text && <p className="text-base break-words">{msg.text}</p>}
                  {msg.fileType && (
                    <div className="mt-2">
                      {msg.fileType.startsWith('image/') && msg.fileUrl ? (
                        <img
                          src={msg.fileUrl}
                          alt={msg.fileName || 'Gambar Terkirim'}
                          className="max-w-full h-auto rounded-md border border-gray-600"
                          onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/200x150/FF0000/FFFFFF?text=Gagal+Memuat+Gambar`; }}
                        />
                      ) : (
                        <div className="bg-gray-600 p-2 rounded-md flex items-center space-x-2">
                          <i className="fas fa-file text-gray-300"></i>
                          <span className="text-sm font-medium truncate">{msg.fileName || 'Dokumen'}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-300 mt-1 text-right">
                    {msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Mengirim...'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Message Input Area */}
      <form onSubmit={handleSendMessage} className="bg-gray-800 p-4 rounded-t-lg shadow-lg flex items-center space-x-3">
        {selectedFile && (
          <div className="absolute -top-12 left-4 bg-gray-700 p-2 rounded-lg flex items-center space-x-2 text-sm">
            <span className="truncate max-w-[150px]">{selectedFile.name}</span>
            <button type="button" onClick={handleClearFile} className="text-red-400 hover:text-red-500">
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current.click()}
          className="bg-gray-600 hover:bg-gray-700 text-white p-3 rounded-lg transition duration-300 ease-in-out"
          title="Lampirkan File"
        >
          <i className="fas fa-paperclip text-lg"></i>
        </button>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Ketik pesan Anda..."
          className="flex-1 p-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
        >
          Kirim
        </button>
      </form>
    </div>
  );
}

export default App;
