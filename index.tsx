import { GoogleGenAI, Type } from "@google/genai";

// --- Mock Data ---
let MOCK_DATA = {
    user: {
        name: "Jose Luis",
        dni: "01927244",
        password: "10220888"
    },
    products: [
        { type: "account", name: "CTA EMPLEADOS SAN", iban: "ES41 0049 4780 1921 1612 4721", balance: 12718.16 },
        { type: "account", name: "CUENTA HUCHA DIGITAL", iban: "ES80 0049 4780 1228 1612 8742", balance: 1525.00 },
        { type: "credit", name: "Credito Santander 1", number: "*0605", disposed: 5660.28, available: 339.72 },
        { type: "credit", name: "CREDITO SANTANDER.", number: "*0527", disposed: 5728.53, available: 271.47 },
        { type: "loan", name: "PRESTAMO CONSUMO", number: "0049 4780 143 0610650", pending: -15297.24 },
        { type: "insurance", name: "SEGURO DE VEHÍCULO", policy: "2002055016903" },
        { type: "insurance", name: "SEGURO DE HOGAR", policy: "051492917206" },
    ],
    transactions: [
        { date: "Lunes, 29 sept", desc: "Transaccion Contactless En...", meta: "Concordia, L´Eliana, Madrid, Tarj.: *397399", amount: -12.00, balance: 12718.16 },
        { date: "", desc: "Bizum, A Favor De Jorge Olmedo", meta: "Concepto: Sin Concepto", amount: -200.00, balance: 12730.16 },
        { date: "Viernes, 26 sept", desc: "Compra Finjet, Barcelona", meta: "Tarjeta 5380010320397399, Comision 0,00", amount: -3.40, balance: 12930.16 },
        { date: "", desc: "Compra Pago Prestamo, 34500", meta: "397399, Tarjeta 5490010320397399, Comision 0,00", amount: -148.02, balance: 12933.56 },
        { date: "Jueves, 25 sept", desc: "Pago Movil En Bazar Y Souveni", meta: "Madrid, Tarj.: *397399", amount: -3.00, balance: 13272.18 },
        { date: "", desc: "Bizum, A Favor De Jorge Olmedo", meta: "Concepto: Sin Concepto", amount: -200.00, balance: 13286.18 },
        { date: "Miercoles, 24 ago", desc: "Supermercado Mercadona", meta: "Madrid, Tarj.: *397399", amount: -85.50, balance: 13486.18 },
    ],
    bizum: {
        mainContact: { name: "Jorge Olmedo V.", phone: "643 545 912", initials: "JO" },
        recents: [
            { date: "26 SEPT", name: "Jorge Olmedo V.", amount: -200.00, status: "Aceptada" },
            { date: "25 SEPT", name: "Jorge Olmedo V.", amount: -200.00, status: "Aceptada" },
            { date: "24 SEPT", name: "Alquiler Piso", amount: -850.00, status: "Aceptada" },
            { date: "23 SEPT", name: "Ana García", amount: 25.50, status: "Recibido" }
        ]
    }
};

let currentData = JSON.parse(JSON.stringify(MOCK_DATA));
let tempNewData = null;
let tempNewBizumData = null;

// --- State ---
let currentPassword = "";
let passwordVisible = false;
let activeScreen = 'login-screen';
let activeFilterMonth: string | null = null;
let selectedFilterMonth: string | null = null;
let geminiContext: 'global' | 'bizum' = 'global';
let previousScreenForGemini = 'login-screen';


// --- Gemini AI ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const dataSchema = {
    type: Type.OBJECT,
    properties: {
        products: {
            type: Type.ARRAY,
            description: "List of financial products. The first account's balance should be the final balance after all transactions.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, description: "Type of product: 'account', 'credit', 'loan', 'insurance'" },
                    name: { type: Type.STRING },
                    iban: { type: Type.STRING, description: "Optional IBAN for 'account' type" },
                    balance: { type: Type.NUMBER, description: "Required for 'account' type. Represents the final balance." },
                },
            },
        },
        transactions: {
            type: Type.ARRAY,
            description: "List of transactions for the main account. They must be chronologically ordered, newest first. The 'balance' property for each transaction must be the correct running balance. Generate between 5 and 10 transactions.",
            items: {
                type: Type.OBJECT,
                properties: {
                    date: { type: Type.STRING, description: "Date of the transaction group, e.g., 'Lunes, 29 sept'. Only for the first transaction of a new day." },
                    desc: { type: Type.STRING, description: "Transaction description." },
                    meta: { type: Type.STRING, description: "Additional transaction metadata." },
                    amount: { type: Type.NUMBER, description: "Transaction amount, negative for expenses." },
                    balance: { type: Type.NUMBER, description: "The running balance of the account *after* this transaction." },
                },
                required: ['desc', 'meta', 'amount', 'balance'],
            },
        },
    },
    required: ['products', 'transactions'],
};

const bizumSchema = {
    type: Type.OBJECT,
    properties: {
        mainContact: {
            type: Type.OBJECT,
            description: "The most frequent or important contact for the main card display.",
            properties: {
                name: { type: Type.STRING },
                phone: { type: Type.STRING },
                initials: { type: Type.STRING, description: "Two-letter initials for the contact's name." }
            },
             required: ['name', 'phone', 'initials']
        },
        recents: {
            type: Type.ARRAY,
            description: "List of 3 to 5 recent Bizum transactions.",
            items: {
                type: Type.OBJECT,
                properties: {
                    date: { type: Type.STRING, description: "Short date format, e.g., '26 SEPT'." },
                    name: { type: Type.STRING },
                    amount: { type: Type.NUMBER, description: "Transaction amount. Negative for sent money, positive for received." },
                    status: { type: Type.STRING, description: "Status can be 'Aceptada', 'Pendiente', 'Rechazada', or 'Recibido'." }
                },
                required: ['date', 'name', 'amount', 'status']
            }
        }
    },
    required: ['mainContact', 'recents']
};


// --- DOM Elements ---
const screens = document.querySelectorAll('.screen');
const numpad = document.getElementById('numpad');
const passwordDisplay = document.getElementById('password-display');
const passwordText = document.getElementById('password-text');
const togglePasswordBtn = document.getElementById('toggle-password');
const loginOkBtn = document.getElementById('login-ok-btn');
const loginError = document.getElementById('login-error');
const productListContainer = document.getElementById('product-list');
const transactionListContainer = document.getElementById('transaction-list');
const totalBalanceEl = document.getElementById('total-balance');
const accountDetailTitle = document.getElementById('account-detail-title');
const accountDetailIban = document.getElementById('account-detail-iban');
const accountDetailBalance = document.getElementById('account-detail-balance');
const filterBtn = document.getElementById('filter-btn');
const filterModal = document.getElementById('filter-modal');
const filterBackdrop = document.getElementById('filter-modal-backdrop');
const closeFilterBtn = document.getElementById('close-filter-btn');
const applyFilterBtn = document.getElementById('apply-filter-btn');
const clearFilterBtn = document.getElementById('clear-filter-btn');
const filterMonthOptionsContainer = document.getElementById('filter-month-options');
const changeUserBtn = document.getElementById('change-user-btn');
const chatHistoryContainer = document.getElementById('chat-history');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const geminiConfirmBtn = document.getElementById('gemini-confirm-btn');

// --- Functions ---

/**
 * Manages screen visibility
 * @param screenId The ID of the screen to show
 */
function showScreen(screenId: string) {
    activeScreen = screenId;
    screens.forEach(screen => {
        if (screen.id === screenId) {
            screen.classList.remove('hidden');
            // A trick to trigger the transition
            setTimeout(() => screen.classList.add('active'), 10);
        } else {
            screen.classList.remove('active');
            // Hide after transition
            setTimeout(() => screen.classList.add('hidden'), 300);
        }
    });
}


/**
 * Updates the password display with dots or text
 */
function updatePasswordDisplay() {
    if (passwordVisible) {
        passwordDisplay.textContent = '';
        passwordText.textContent = currentPassword;
        passwordText.classList.remove('hidden');
    } else {
        passwordDisplay.textContent = '●'.repeat(currentPassword.length);
        passwordText.textContent = '';
        passwordText.classList.add('hidden');
    }
}

/**
 * Handles numpad key presses
 * @param key The key that was pressed ('0'-'9', 'backspace', 'ok')
 */
function handleNumpad(key: string) {
    if (/\d/.test(key) && currentPassword.length < 8) {
        currentPassword += key;
    } else if (key === 'backspace') {
        currentPassword = currentPassword.slice(0, -1);
    }
    loginError.classList.add('hidden');
    updatePasswordDisplay();
}

/**
 * Handles the login attempt
 */
function handleLogin() {
    if (currentPassword === currentData.user.password) {
        renderAllData();
        showScreen('home-screen');
    } else {
        loginError.classList.remove('hidden');
        // Vibrate for feedback if supported
        if(navigator.vibrate) navigator.vibrate(200);
    }
}

/**
 * Toggles the password visibility
 */
function togglePasswordVisibility() {
    passwordVisible = !passwordVisible;
    const icon = togglePasswordBtn.querySelector('.material-symbols-outlined');
    icon.textContent = passwordVisible ? 'visibility_off' : 'visibility';
    updatePasswordDisplay();
}

/**
 * Renders all dynamic data on the screen
 */
function renderAllData() {
    renderProducts();
    renderTransactions();
    updateAccountDetailsHeader();
    renderBizumData();

    const totalBalance = currentData.products
        .filter(p => p.type === 'account')
        .reduce((sum, acc) => sum + acc.balance, 0);

    totalBalanceEl.textContent = totalBalance.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}


/**
 * Renders the list of financial products on the home screen
 */
function renderProducts() {
    let html = '';
    currentData.products.forEach(p => {
        switch (p.type) {
            case 'account':
                html += `
                    <div class="product-card account" data-target="account-details-screen">
                        <div class="product-card-header">
                            <h4>${p.name}</h4>
                            <img src="https://www.santander.com/content/dam/santander-com/es/assets/marca/logo-santander-rojo.svg" alt="Santander" height="20">
                        </div>
                        <div class="product-card-body"><p>${p.iban}</p></div>
                        <div class="product-card-footer">
                            <p>Saldo</p>
                            <span class="balance">${p.balance.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>
                        </div>
                    </div>`;
                break;
            case 'credit':
                 html += `
                     <div class="product-card credit">
                        <div class="product-card-header"><h4>${p.name}</h4></div>
                        <div class="product-card-body"><p>Crédito | ${p.number}</p></div>
                        <div class="product-card-footer">
                            <div><p>Dispuesto</p><span class="balance">${(p.disposed || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span></div>
                            <div><p>Disponible</p><span class="balance-small">${(p.available || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span></div>
                        </div>
                    </div>`;
                break;
             case 'loan':
                html += `
                     <div class="product-card loan">
                        <div class="product-card-header"><h4>${p.name}</h4></div>
                        <div class="product-card-body"><p>${p.number}</p></div>
                        <div class="product-card-footer">
                            <p>Importe pendiente</p>
                            <span class="balance">${(p.pending || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>
                        </div>
                    </div>`;
                break;
            case 'insurance':
                 html += `
                     <div class="product-card insurance">
                        <div class="product-card-header"><h4>${p.name}</h4></div>
                        <div class="product-card-body"><p>${p.policy}</p></div>
                    </div>`;
                break;
        }
    });
    productListContainer.innerHTML = html;

    document.querySelectorAll('.product-card[data-target]').forEach(card => {
        card.addEventListener('click', (e) => {
            const targetScreen = (e.currentTarget as HTMLElement).dataset.target;
            if(targetScreen) showScreen(targetScreen);
        });
    });
}

function updateAccountDetailsHeader() {
    const mainAccount = currentData.products.find(p => p.type === 'account');
    if (mainAccount) {
        accountDetailTitle.textContent = mainAccount.name;
        accountDetailIban.textContent = mainAccount.iban;
        accountDetailBalance.textContent = mainAccount.balance.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    }
}

/**
 * Renders the list of transactions on the account details screen
 */
function renderTransactions() {
    let html = '';
    let lastDate = '';
    const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

    const filteredTransactions = activeFilterMonth 
        ? currentData.transactions.filter(t => {
              if (!t.date) return false;
              const monthAbbr = t.date.split(' ').pop();
              const monthIndex = monthNames.indexOf(monthAbbr);
              const transactionDate = new Date();
              transactionDate.setMonth(monthIndex);
              return transactionDate.toLocaleString('es-ES', { month: 'long' }) === activeFilterMonth;
           })
        : currentData.transactions;


    filteredTransactions.forEach(t => {
        if (t.date && t.date !== lastDate) {
            html += `<div class="transaction-group"><h5>${t.date}</h5></div>`;
            lastDate = t.date;
        }
        html += `
            <div class="transaction-item">
                <div class="transaction-details">
                    <p class="desc">${t.desc}</p>
                    <p class="meta">${t.meta}</p>
                </div>
                <div class="transaction-amount">
                    <p class="amount ${t.amount > 0 ? 'positive' : ''}">${t.amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
                    <p class="running-balance">${t.balance.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
                </div>
            </div>`;
    });
    transactionListContainer.innerHTML = html || `<p style="padding: 1rem; text-align: center;">No hay movimientos para el mes seleccionado.</p>`;
}

function renderBizumData() {
    const mainContactCard = document.getElementById('bizum-main-contact-card');
    const recentsContainer = document.getElementById('bizum-recent-transactions-container');
    
    if (!mainContactCard || !recentsContainer || !currentData.bizum) return;
    
    const { mainContact, recents } = currentData.bizum;

    // Update main contact
    mainContactCard.innerHTML = `
        <div class="contact-initials">${mainContact.initials}</div>
        <h4>${mainContact.name}</h4>
        <p>${mainContact.phone}</p>
    `;

    // Update recents
    recentsContainer.innerHTML = recents.map(t => `
        <div class="recent-card">
            <p>${t.date}</p>
            <h5>${t.name}</h5>
            <p class="amount ${t.amount > 0 ? 'positive' : ''}">${t.amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
            <span class="status ${t.status.toLowerCase()}">${t.status}</span>
        </div>
    `).join('');
}


function toggleFilterModal(show: boolean) {
    if (show) {
        populateFilterMonths();
        filterModal.classList.remove('hidden');
        filterBackdrop.classList.remove('hidden');
        setTimeout(() => filterModal.classList.add('active'), 10);
    } else {
        filterModal.classList.remove('active');
        setTimeout(() => {
            filterModal.classList.add('hidden');
            filterBackdrop.classList.add('hidden');
        }, 300);
    }
}

function getUniqueMonths() {
    const months = new Set<string>();
    const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
    currentData.transactions.forEach(t => {
        if (t.date) {
            const monthAbbr = t.date.split(' ').pop();
            const monthIndex = monthNames.indexOf(monthAbbr);
            if(monthIndex !== -1) {
                const date = new Date();
                date.setMonth(monthIndex);
                months.add(date.toLocaleString('es-ES', { month: 'long' }));
            }
        }
    });
    return Array.from(months);
}


function populateFilterMonths() {
    const months = getUniqueMonths().slice(0, 2); // Limit to two months
    filterMonthOptionsContainer.innerHTML = months.map(month => `
        <label class="month-option" data-month="${month}">
            <input type="radio" name="month" value="${month}">
            ${month.charAt(0).toUpperCase() + month.slice(1)}
        </label>
    `).join('');

    document.querySelectorAll('.month-option input').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            selectedFilterMonth = target.value;
            document.querySelectorAll('.month-option').forEach(opt => opt.classList.remove('selected'));
            target.parentElement.classList.add('selected');
        });
    });
}

/**
 * Adds a message to the chat history UI
 */
function addChatMessage(role: 'user' | 'model' | 'loading', content: string) {
    const messageEl = document.createElement('div');
    if (role === 'loading') {
        messageEl.classList.add('chat-message', 'model', 'loading');
        messageEl.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div>`;
        messageEl.id = 'loading-message';
    } else {
        messageEl.classList.add('chat-message', role);
        messageEl.textContent = content;
    }
    chatHistoryContainer.appendChild(messageEl);
    chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
}

async function handleGeminiPrompt(prompt: string) {
    addChatMessage('user', prompt);
    addChatMessage('loading', '');
    geminiConfirmBtn.classList.add('hidden');
    tempNewData = null;
    tempNewBizumData = null;

    let promptToGemini = '';
    let schemaToUse = null;
    let successMessage = '';

    if (geminiContext === 'bizum') {
        promptToGemini = `Basado en esta petición del usuario: "${prompt}", genera un nuevo conjunto de datos de Bizum simulados. Incluye un contacto principal y entre 3 y 5 transacciones recientes. Los importes deben ser coherentes y variados.`;
        schemaToUse = bizumSchema;
        successMessage = 'He generado los nuevos datos de Bizum. ¿Confirmas para verlos?';
    } else { // global
        promptToGemini = `Basado en esta petición del usuario: "${prompt}", genera un nuevo conjunto de datos financieros simulados. Asegúrate de que los saldos y las transacciones son coherentes. El saldo final de la cuenta principal debe ser el resultado de aplicar todas las transacciones. El saldo corriente de cada transacción debe ser correcto.`;
        schemaToUse = dataSchema;
        successMessage = '¡Perfecto! He generado los nuevos datos. ¿Quieres confirmar y volver al inicio?';
    }

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptToGemini,
            config: {
                responseMimeType: "application/json",
                responseSchema: schemaToUse,
            },
        });
        
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) loadingMessage.remove();

        const jsonStr = response.text.trim();
        const newData = JSON.parse(jsonStr);

        // Basic validation and store temp data
        if (geminiContext === 'bizum' && newData.mainContact && newData.recents) {
            tempNewBizumData = newData;
            addChatMessage('model', successMessage);
            geminiConfirmBtn.classList.remove('hidden');
        } else if (geminiContext === 'global' && newData.products && newData.transactions) {
            tempNewData = newData;
            addChatMessage('model', successMessage);
            geminiConfirmBtn.classList.remove('hidden');
        } else {
            throw new Error("Invalid data structure received.");
        }

    } catch(error) {
        console.error("Gemini API Error:", error);
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) loadingMessage.remove();
        addChatMessage('model', 'Lo siento, he tenido un problema al generar los datos. ¿Podrías intentarlo de nuevo con otra petición?');
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch(err => {
                    console.log('ServiceWorker registration failed: ', err);
                });
        });
    }

    renderBizumData(); // Render initial bizum data

    numpad.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const key = (target.closest('.num-btn') as HTMLElement)?.dataset.key;
        if (key && key !== 'ok') {
            handleNumpad(key);
        }
    });

    loginOkBtn.addEventListener('click', handleLogin);
    togglePasswordBtn.addEventListener('click', togglePasswordVisibility);

    // Filter modal listeners
    filterBtn.addEventListener('click', () => toggleFilterModal(true));
    closeFilterBtn.addEventListener('click', () => toggleFilterModal(false));
    filterBackdrop.addEventListener('click', () => toggleFilterModal(false));
    applyFilterBtn.addEventListener('click', () => {
        activeFilterMonth = selectedFilterMonth;
        renderTransactions();
        toggleFilterModal(false);
    });
    clearFilterBtn.addEventListener('click', () => {
        activeFilterMonth = null;
        selectedFilterMonth = null;
        renderTransactions();
        toggleFilterModal(false);
    });

    // Gemini Chat listeners
    changeUserBtn.addEventListener('click', () => {
        geminiContext = 'global';
        previousScreenForGemini = 'login-screen';
        chatHistoryContainer.innerHTML = '';
        addChatMessage('model', 'Hola, soy tu asistente de datos. ¿Qué tipo de saldo y movimientos te gustaría ver?');
        showScreen('gemini-screen');
    });

    document.getElementById('bizum-menu-btn').addEventListener('click', () => {
        geminiContext = 'bizum';
        previousScreenForGemini = 'bizum-screen';
        chatHistoryContainer.innerHTML = '';
        addChatMessage('model', 'Hola, soy tu asistente Bizum. ¿Qué tipo de movimientos Bizum te gustaría simular?');
        showScreen('gemini-screen');
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const prompt = chatInput.value.trim();
        if (prompt) {
            handleGeminiPrompt(prompt);
            chatInput.value = '';
        }
    });

    geminiConfirmBtn.addEventListener('click', () => {
        if (geminiContext === 'bizum' && tempNewBizumData) {
            currentData.bizum = tempNewBizumData;
            renderBizumData();
            showScreen('bizum-screen');
            tempNewBizumData = null; // Clear temp data
        } else if (geminiContext === 'global' && tempNewData) {
            currentData.products = tempNewData.products;
            currentData.transactions = tempNewData.transactions;
            
            // Reset state before going to login
            currentPassword = "";
            passwordVisible = false;
            updatePasswordDisplay();
            loginError.classList.add('hidden');
            
            showScreen('login-screen');
            tempNewData = null; // Clear temp data
        }
    });


    // Generic navigation buttons
    document.body.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        
        const backBtn = target.closest('.back-btn');
        if (backBtn) {
            // Special handling for Gemini screen back button
            if (backBtn.closest('#gemini-screen')) {
                showScreen(previousScreenForGemini);
            } else {
                const targetScreen = backBtn.getAttribute('data-target');
                if (targetScreen) showScreen(targetScreen);
            }
            return;
        }

        const bizumBtn = target.closest('#bizum-btn');
        if (bizumBtn) {
            showScreen('bizum-screen');
            return;
        }

        const menuBtn = target.closest('#home-menu-btn');
        if (menuBtn) {
            showScreen('menu-screen');
            return;
        }
    });

    showScreen('login-screen');
});