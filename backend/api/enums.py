from django.db import models
import enum


class UserTier(models.TextChoices):
    BASIC = 'basic', 'Basic'
    PRO = 'pro', 'Pro'
