const admin = require('firebase-admin');

// Inicializa o Firebase com a chave de serviço
if (!admin.apps.length) {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  // Libera permissões CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { event, payment } = req.body || {};
  if (!payment || !payment.customerEmail) {
    return res.status(400).json({ error: 'Dados do pagador ausentes' });
  }

  const customerEmail = payment.customerEmail;

  try {
    // 1. Localiza o usuário no Firebase Auth pelo e-mail
    const userRecord = await admin.auth().getUserByEmail(customerEmail);
    const userId = userRecord.uid;
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    // 2. Se o pagamento foi APROVADO / CONFIRMADO
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

      return res.status(200).json({ success: true, message: 'Plano Pro ativado!' });
    } 
    // 3. Se a assinatura VENCEU ou foi CANCELADA
    else if (event === 'PAYMENT_OVERDUE' || event === 'SUBSCRIPTION_DELETED') {
      await userDocRef.set({
        plan: 'free',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Plano alterado para Free.' });
    }

    return res.status(200).json({ success: true, message: 'Evento processado.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
