const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, reviewController.getDueReviews);
router.get('/plan', authMiddleware, reviewController.getPlan);
router.post('/:id', authMiddleware, reviewController.submitReview);

module.exports = router;
