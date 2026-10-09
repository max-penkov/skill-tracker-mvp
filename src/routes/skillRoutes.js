const express = require('express');
const router = express.Router();
const skillController = require('../controllers/skillController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, skillController.getUserSkills);
router.post('/', authMiddleware, skillController.createSkill);
router.get('/:id/stats', authMiddleware, skillController.getSkillStats);
router.patch('/modules/:moduleId', authMiddleware, skillController.toggleModule);

module.exports = router;
