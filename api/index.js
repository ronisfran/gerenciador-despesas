const admin = require('firebase-admin');

// 1. Inicializa o Firebase Admin usando a chave de serviço local
if (!admin.apps.length) {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Token de autenticação seguro de 32 caracteres
const ASAAS_TOKEN = "k9Xm2$P8vL#4qZ1wN7tY5rE3uI6oA0sB";

module.exports = async (req, res) => {
  // Configuração dos cabeçalhos CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, asaas-access-token');

  // Responde imediatamente às requisições preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Aceita apenas requisições do tipo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // 2. Validação do Token de Segurança enviado pelo Asaas
  const requestToken = req.headers['asaas-access-token'];
  if (requestToken !== ASAAS_TOKEN) {
    return res.status(401).json({ error: 'Token de autenticação inválido' });
  }

  const { event, payment } = req.body || {};

  if (!payment || !payment.customerEmail) {
    return res.status(400).json({ error: 'Dados de pagamento ou e-mail do cliente ausentes' });
  }

  const customerEmail = payment.customerEmail;

  try {
    // 3. Localiza o usuário no Firebase Auth pelo e-mail
    const userRecord = await admin.auth().getUserByEmail(customerEmail);
    const userId = userRecord.uid;
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    // 4. Pagamento APROVADO ou CONFIRMADO
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      let currentEndDate = new Date();

      if (userDoc.exists) {
        const data = userDoc.data();
        if (data.subscriptionEndDate && new Date(data.subscriptionEndDate) > new Date()) {
          currentEndDate = new Date(data.subscriptionEndDate);
        }
      }

      currentEndDate.setDate(currentEndDate.getDate() + 30);

      await userDocRef.set({
        plan: 'pro',
        subscriptionEndDate: currentEndDate.toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      console.log(`[ASAAS WEBHOOK] Plano PRO ativado para ${customerEmail} até ${currentEndDate.toISOString()}`);
      return res.status(200).json({ success: true, message: 'Plano Pro ativado com sucesso!' });
    } 
    
    // 5. Pagamento VENCIDO ou Assinatura CANCELADA
    else if (event === 'PAYMENT_OVERDUE' || event === 'SUBSCRIPTION_DELETED') {
      await userDocRef.set({
        plan: 'free',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      console.log(`[ASAAS WEBHOOK] Plano do usuário ${customerEmail} alterado para FREE.`);
      return res.status(200).json({ success: true, message: 'Plano alterado para Free.' });
    }

    return res.status(200).json({ success: true, message: 'Evento recebido e processado.' });

  } catch (error) {
    console.error('[ASAAS WEBHOOK ERROR]', error);
    return res.status(500).json({ error: error.message });
  }
};
