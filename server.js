// server.js
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// وضعیت ربات
let robotStatus = 'off';

// middleware برای پردازش JSON
app.use(express.json());

// route اصلی برای بررسی وضعیت سرور
app.get('/', (req, res) => {
  res.send('سرور ربات فعال است! از POST به /robot/on یا /robot/off برای کنترل استفاده کنید.');
});

// route برای روشن کردن ربات
app.post('/robot/on', (req, res) => {
  if (robotStatus === 'off') {
    robotStatus = 'on';
    console.log('ربات روشن شد.');
    // اینجا می‌توانید کدهای خاص ربات خود را فراخوانی کنید
    res.status(200).json({ message: 'ربات روشن شد.', status: robotStatus });
  } else {
    res.status(200).json({ message: 'ربات از قبل روشن است.', status: robotStatus });
  }
});

// route برای خاموش کردن ربات
app.post('/robot/off', (req, res) => {
  if (robotStatus === 'on') {
    robotStatus = 'off';
    console.log('ربات خاموش شد.');
    // اینجا می‌توانید کدهای توقف ربات را فراخوانی کنید
    res.status(200).json({ message: 'ربات خاموش شد.', status: robotStatus });
  } else {
    res.status(200).json({ message: 'ربات از قبل خاموش است.', status: robotStatus });
  }
});

// route برای بررسی وضعیت فعلی ربات
app.get('/robot/status', (req, res) => {
  res.status(200).json({ status: robotStatus });
});

// راه‌اندازی سرور
app.listen(port, () => {
  console.log(`سرور در حال اجرا روی پورت ${port}`);
});
