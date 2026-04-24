const express = require('express');
const router = express.Router();

let memory = {};

router.get('/', (req,res)=>{
  const {category} = req.query;
  res.json({ok:true,data:memory[category]||null});
});

router.post('/', (req,res)=>{
  const {category,data} = req.body;
  memory[category]=data;
  res.json({ok:true});
});

module.exports = router;
