// Get JWT token from localStorage (optional for guests)
const token = localStorage.getItem('jwt_token')

const socket = io({
    auth: {
        token: token || null
    }
})

const msgInput = document.querySelector('#message')
const nameInput = document.querySelector('#name')
const tokenInput = document.querySelector('#token')
const chatRoom = document.querySelector('#room')
const activity = document.querySelector('.activity')
const usersList = document.querySelector('.user-list')
const roomList = document.querySelector('.room-list')
const chatDisplay = document.querySelector('.chat-display')
const joinContainer = document.querySelector('#joinContainer')
const chatInterface = document.querySelector('#chatInterface')
const currentRoomDisplay = document.querySelector('#currentRoom')

// Show/hide inputs based on token
function toggleInputs() {
    const hasToken = tokenInput.value.trim()
    if (hasToken) {
        nameInput.style.display = 'none'
        chatRoom.style.display = 'none'
        nameInput.required = false
        chatRoom.required = false
    } else {
        nameInput.style.display = 'block'
        chatRoom.style.display = 'block'
        nameInput.required = true
        chatRoom.required = true
        nameInput.placeholder = 'Your name'
        chatRoom.placeholder = 'Room name'
    }
}

// Initial setup
if (token) {
    nameInput.style.display = 'none'
    const nameLabel = document.querySelector('label[for="name"]')
    if (nameLabel) nameLabel.style.display = 'none'
} else {
    toggleInputs()
}

// Listen for token input changes
tokenInput.addEventListener('input', toggleInputs)

function sendMessage(e) {
    e.preventDefault()
    if (msgInput.value.trim()) {
        socket.emit('message', {
            text: escapeHtml(msgInput.value.trim())
        })
        msgInput.value = ""
    }
    msgInput.focus()
}

function enterRoom(e) {
    e.preventDefault()
    
    // Check if user provided token
    const userToken = tokenInput.value.trim()
    let finalRoom = chatRoom.value
    
    if (userToken) {
        // If token provided, create room based on user ID from token
        try {
            const payload = JSON.parse(atob(userToken.split('.')[1]))
            finalRoom = `user_${payload.userId || payload.id}`
            console.log('Token user room:', finalRoom)
        } catch (e) {
            alert('Invalid token format')
            return
        }
    } else {
        // Without token, require name and room
        if (!nameInput.value || !chatRoom.value) {
            alert('Please enter your name and room name')
            return
        }
    }
    
    if (finalRoom && (token || nameInput.value || userToken)) {
        const roomData = { room: finalRoom }
        if (!token && nameInput.value && !userToken) {
            roomData.guestName = nameInput.value
        }
        if (userToken) {
            roomData.userToken = userToken
        }
        
        socket.emit('enterRoom', roomData)
        // Hide join form and show chat interface
        joinContainer.style.display = 'none'
        chatInterface.style.display = 'flex'
        currentRoomDisplay.textContent = userToken ? 'Personal Chat' : finalRoom
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

// Debounced typing indicator
let typingTimer
function handleTyping() {
    socket.emit('activity')
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => {
        socket.emit('stopActivity')
    }, 1000)
}

document.querySelector('.form-msg')
    .addEventListener('submit', sendMessage)

document.querySelector('.form-join')
    .addEventListener('submit', enterRoom)

msgInput.addEventListener('input', handleTyping)

// Listen for messages 
socket.on("message", (data) => {
    activity.textContent = ""
    const { name, text, time } = data
    const li = document.createElement('li')
    li.className = 'post'
    
    // Get current user name
    let currentUserName = ''
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            currentUserName = payload.name
        } catch (e) {}
    } else {
        currentUserName = nameInput.value || 'Guest'
    }
    
    if (name === currentUserName) {
        li.className = 'post post--right'
    } else if (name === 'Admin') {
        li.className = 'post post--admin'
    } else if (name !== 'WhatsApp') {
        li.className = 'post post--left'
    }
    
    if (name !== 'WhatsApp') {
        const nameSpan = document.createElement('span')
        nameSpan.className = 'post__header--name'
        nameSpan.textContent = name
        
        const timeSpan = document.createElement('span')
        timeSpan.className = 'post__header--time'
        timeSpan.textContent = time
        
        const header = document.createElement('div')
        header.className = 'post__header'
        header.appendChild(nameSpan)
        header.appendChild(timeSpan)
        
        const textDiv = document.createElement('div')
        textDiv.className = 'post__text'
        textDiv.textContent = text
        
        li.appendChild(header)
        li.appendChild(textDiv)
    } else {
        const textDiv = document.createElement('div')
        textDiv.className = 'post__text'
        textDiv.textContent = text
        li.appendChild(textDiv)
        li.style.background = 'rgba(102, 126, 234, 0.1)'
        li.style.color = '#667eea'
        li.style.textAlign = 'center'
        li.style.alignSelf = 'center'
        li.style.maxWidth = '80%'
        li.style.fontSize = '13px'
        li.style.padding = '8px 16px'
        li.style.borderRadius = '18px'
    }
    
    chatDisplay.appendChild(li)
    chatDisplay.scrollTop = chatDisplay.scrollHeight
})

let activityTimer
socket.on("activity", (name) => {
    activity.textContent = `${name} is typing...`
    activity.style.display = 'block'
    
    clearTimeout(activityTimer)
    activityTimer = setTimeout(() => {
        activity.textContent = ""
        activity.style.display = 'none'
    }, 3000)
})

socket.on('connect', () => {
    console.log('Connected to server')
})

socket.on('disconnect', () => {
    console.log('Disconnected from server')
    // Show reconnection message
    const reconnectMsg = document.createElement('div')
    reconnectMsg.textContent = 'Connection lost. Trying to reconnect...'
    reconnectMsg.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        z-index: 1000;
    `
    document.body.appendChild(reconnectMsg)
    
    setTimeout(() => {
        if (document.body.contains(reconnectMsg)) {
            document.body.removeChild(reconnectMsg)
        }
    }, 5000)
})

socket.on('userList', ({ users }) => {
    showUsers(users)
})

socket.on('roomList', ({ rooms }) => {
    showRooms(rooms)
})

function showUsers(users) {
    if (users && users.length > 0) {
        const userCount = users.length
        const userNames = users.map(user => user.name).join(', ')
        usersList.textContent = `${userCount} participant${userCount > 1 ? 's' : ''}: ${userNames}`
    } else {
        usersList.textContent = 'No participants'
    }
}

function showRooms(rooms) {
    roomList.innerHTML = ''
    if (rooms && rooms.length > 0) {
        const title = document.createElement('div')
        title.innerHTML = '<strong>Active Rooms:</strong>'
        title.style.marginBottom = '10px'
        roomList.appendChild(title)
        
        rooms.forEach(room => {
            const roomItem = document.createElement('div')
            roomItem.style.padding = '8px 12px'
            roomItem.style.borderRadius = '8px'
            roomItem.style.marginBottom = '4px'
            roomItem.style.cursor = 'pointer'
            roomItem.style.transition = 'background-color 0.2s'
            roomItem.textContent = `# ${room}`
            
            roomItem.addEventListener('mouseenter', () => {
                roomItem.style.backgroundColor = '#3b4a54'
            })
            
            roomItem.addEventListener('mouseleave', () => {
                roomItem.style.backgroundColor = 'transparent'
            })
            
            roomList.appendChild(roomItem)
        })
    }
}
