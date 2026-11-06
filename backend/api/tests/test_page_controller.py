"""
Standalone unit tests for the Page Budget Controller.
These tests do not require Django to boot — they test pure Python logic.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import MagicMock
sys.modules['django'] = MagicMock()
sys.modules['django.conf'] = MagicMock()
sys.modules['django.conf'].settings = MagicMock()
sys.modules['django.conf'].settings.configured = False

import logging
logging.disable(logging.CRITICAL)

from page_controller import (
    DEFAULT_MIN_PAGES, DEFAULT_MAX_PAGES, DEFAULT_TARGET_PAGES, WORDS_PER_PAGE,
    SECTION_WORD_BUDGETS, REQUIRED_SECTION_ORDER, FRONT_MATTER_KEYS,
    OPTIONAL_SECTIONS, FIXED_TEXT_SECTIONS, FACT_IMPORTANCE,
    SectionBudget, PageCountResult, CondenseResult,
    compute_section_budgets, rank_facts_by_importance, condense_section_content,
    validate_page_range, count_section_words, compute_section_word_budgets,
    get_page_settings, _group_days_into_week_ranges, _merge_repeated_tasks,
    _drop_low_importance_facts,
)

class TestBudgetConstants:
    """Test that budget constants are sane."""

    def test_min_less_than_max(self):
        assert DEFAULT_MIN_PAGES < DEFAULT_MAX_PAGES

    def test_target_in_range(self):
        assert DEFAULT_MIN_PAGES <= DEFAULT_TARGET_PAGES <= DEFAULT_MAX_PAGES

    def test_words_per_page_positive(self):
        assert WORDS_PER_PAGE > 0

    def test_all_required_sections_have_budgets(self):
        for key in REQUIRED_SECTION_ORDER:
            assert key in SECTION_WORD_BUDGETS, f"Missing budget for {key}"
            assert SECTION_WORD_BUDGETS[key] >= 0

    def test_fact_importance_has_all_kinds(self):
        kinds = {'activity', 'tool', 'equipment', 'quantity', 'skill', 'duty',
                 'project', 'challenge', 'solution', 'person', 'organisation_detail',
                 'recommendation', 'personal_statement'}
        for kind in kinds:
            assert kind in FACT_IMPORTANCE, f"Missing importance for {kind}"
            assert FACT_IMPORTANCE[kind] > 0


class TestSectionBudgets:
    """Test per-section budget computation."""

    def test_compute_section_budgets_returns_all_sections(self):
        budgets = compute_section_budgets()
        assert len(budgets) == len(REQUIRED_SECTION_ORDER)
        for key in REQUIRED_SECTION_ORDER:
            assert key in budgets
            b = budgets[key]
            assert isinstance(b, SectionBudget)
            assert b.word_budget >= 0
            assert b.min_words <= b.max_words

    def test_fixed_text_sections_have_narrow_bounds(self):
        budgets = compute_section_budgets()
        for key in FIXED_TEXT_SECTIONS:
            b = budgets[key]
            assert b.is_fixed_text
            base = SECTION_WORD_BUDGETS[key]
            assert b.min_words >= int(base * 0.75)
            assert b.max_words <= int(base * 1.15)

    def test_optional_sections_can_be_zero(self):
        budgets = compute_section_budgets()
        for key in OPTIONAL_SECTIONS:
            b = budgets[key]
            assert b.is_optional
            assert b.min_words == 0

    def test_front_matter_flagged(self):
        budgets = compute_section_budgets()
        for key in FRONT_MATTER_KEYS:
            b = budgets[key]
            assert b.is_front_matter


class TestWordCounting:
    """Test word counting utilities."""

    def test_count_section_words_empty(self):
        assert count_section_words("") == 0
        assert count_section_words(None) == 0

    def test_count_section_words_plain(self):
        assert count_section_words("Hello world") == 2

    def test_count_section_words_strips_html(self):
        assert count_section_words("<p>Hello <strong>world</strong></p>") == 2

    def test_count_section_words_multiple_spaces(self):
        assert count_section_words("Hello   world  test") == 3


class TestValidatePageRange:
    """Test page range validation."""

    def test_within_range(self):
        result = validate_page_range(13, min_pages=12, max_pages=15)
        assert result.within_range
        assert not result.over_limit
        assert not result.under_limit
        assert result.total_pages == 13

    def test_at_min_boundary(self):
        result = validate_page_range(12, min_pages=12, max_pages=15)
        assert result.within_range

    def test_at_max_boundary(self):
        result = validate_page_range(15, min_pages=12, max_pages=15)
        assert result.within_range

    def test_over_limit(self):
        result = validate_page_range(16, min_pages=12, max_pages=15)
        assert result.over_limit
        assert not result.within_range

    def test_under_limit(self):
        result = validate_page_range(11, min_pages=12, max_pages=15)
        assert result.under_limit
        assert not result.within_range


class TestCondensation:
    """Test content condensation logic."""

    def test_condense_under_budget_no_change(self):
        budget = SectionBudget(
            key="ch3_activities", word_budget=400, min_words=240,
            max_words=560, is_required=True, is_front_matter=False,
            is_fixed_text=False, is_optional=False,
        )
        content = "<p>Short content.</p>"
        facts = []
        result = condense_section_content("ch3_activities", content, facts, budget)
        assert result.condensed_word_count == result.original_word_count
        assert result.changes_made == []

    def test_condense_over_budget_week_ranges(self):
        budget = SectionBudget(
            key="ch3_activities", word_budget=100, min_words=60,
            max_words=30, is_required=True, is_front_matter=False,
            is_fixed_text=False, is_optional=False,
        )
        content = ("<p>Monday: Fixed computer and replaced RAM modules. "
                   "Tuesday: Installed RAM and configured network settings. "
                   "Wednesday: Configured network switches and routers. "
                   "Thursday: Installed software applications and updates. "
                   "Friday: Tested systems and documented findings. "
                   "Saturday: Performed maintenance and backups. "
                   "Sunday: Documented findings and wrote reports.</p>")
        facts = []
        result = condense_section_content("ch3_activities", content, facts, budget)
        assert result.changes_made
        assert result.original_word_count > budget.max_words


    def test_merge_repeated_tasks(self):
        content = ("<p>I installed a router. I installed a switch. "
                   "I installed a server. I installed a printer.</p>")
        result = _merge_repeated_tasks(content)
        assert result[1]
        assert "various systems" in result[0] or "Specifically:" in result[0]

    def test_drop_low_importance_facts(self):
        class MockFact:
            def __init__(self, kind, text=""):
                self.kind = kind
                self.text = text

        budget = SectionBudget(
            key="ch3_tools", word_budget=50, min_words=30, max_words=70,
            is_required=True, is_front_matter=False,
            is_fixed_text=False, is_optional=False,
            fact_importance_cap=5,
        )
        facts = [
            MockFact("tool", "Cisco router"),
            MockFact("personal_statement", "I learned a lot"),
        ]
        content = "I used a Cisco router. I learned a lot during training."
        condensed, dropped = _drop_low_importance_facts(content, facts, budget)
        assert dropped >= 1


class TestRankFacts:
    """Test fact importance ranking."""

    def test_tools_rank_highest(self):
        class MockFact:
            def __init__(self, kind, text=""):
                self.kind = kind
                self.text = text

        facts = [
            MockFact("personal_statement", ""),
            MockFact("tool", "router"),
            MockFact("skill", "networking"),
        ]
        ranked = rank_facts_by_importance(facts)
        assert ranked[0].kind == "tool"
        assert ranked[-1].kind == "personal_statement"


class TestGetPageSettings:
    """Test page settings accessor."""

    def test_defaults_when_no_options(self):
        class MockReport:
            template_options = {}

        settings = get_page_settings(MockReport())
        assert settings["min_pages"] == DEFAULT_MIN_PAGES
        assert settings["max_pages"] == DEFAULT_MAX_PAGES
        assert settings["target_pages"] == DEFAULT_TARGET_PAGES


class TestComputeWordBudgets:
    """Test dynamic word budget computation."""

    def test_few_facts_reduces_chapter_three(self):
        budgets = compute_section_word_budgets(project_facts_count=5, total_confirmed_facts=5)
        assert budgets["ch3_activities"] <= 200

    def test_many_facts_allows_expansion(self):
        budgets = compute_section_word_budgets(project_facts_count=50, total_confirmed_facts=50)
        assert budgets["ch3_activities"] >= 400

