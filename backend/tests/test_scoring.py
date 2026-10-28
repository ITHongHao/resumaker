from app.models import Requirement
from app.scoring import RequirementMatch, ScoreResult, potential_score, score, strip_latex


def req(term: str, weight: int = 1, kind: str = "skill") -> Requirement:
    return Requirement(term=term, kind=kind, weight=weight)


def status_of(term: str, text: str) -> str:
    return score([req(term)], text).matches[0].status


def test_all_matched_scores_100():
    result = score([req("Python"), req("Docker", 3)], "Built Python services in Docker.")
    assert result == ScoreResult(
        score=100,
        matches=[RequirementMatch(term="Python", status="matched"), RequirementMatch(term="Docker", status="matched")],
    )


def test_none_matched_scores_0():
    result = score([req("Rust"), req("Haskell", 2)], "Wrote Python and Go.")
    assert result.score == 0
    assert [m.status for m in result.matches] == ["missing", "missing"]


def test_weight_changes_score():
    text = "Python only"
    low = score([req("Python", 1), req("Rust", 3)], text).score
    high = score([req("Python", 3), req("Rust", 1)], text).score
    assert low == 25
    assert high == 75


def test_case_insensitive_whole_word():
    assert status_of("Java", "Experienced with JAVA and spring") == "matched"
    assert status_of("Java", "Experienced with JavaScript") == "missing"
    assert status_of("Script", "JavaScript") == "missing"


def test_empty_requirements_scores_0_without_error():
    assert score([], "anything") == ScoreResult(score=0, matches=[])
    assert potential_score([], "anything", [("a", "b")]) == 0


def test_potential_score_applies_replacements():
    reqs = [req("Python"), req("Kafka")]
    text = "Used Python and Spark."
    before = score(reqs, text).score
    assert before == 50
    assert potential_score(reqs, text, [("Spark", "Kafka")]) == 100
    # unchanged input, missing "old" is skipped
    assert score(reqs, text).score == before
    assert potential_score(reqs, text, [("nonexistent", "Kafka")]) == 50


def test_potential_score_replaces_first_occurrence_in_order():
    reqs = [req("Kafka"), req("Go")]
    text = "A A"
    assert potential_score([req("B")], text, [("A", "B")]) == 100
    assert potential_score(reqs, "x Spark Spark", [("Spark", "Kafka"), ("Kafka", "Go")]) == 50


def test_score_is_deterministic():
    reqs = [req("Python", 2), req("PyTorch", 3), req("Rust")]
    text = "Python with torch"
    assert score(reqs, text) == score(reqs, text)
    assert potential_score(reqs, text, [("torch", "PyTorch")]) == potential_score(reqs, text, [("torch", "PyTorch")])


def test_partial_counts_half_and_rounds_half_up():
    # PyTorch ~ torch is partial: 0.5 of weight 1 -> 50
    assert score([req("PyTorch")], "used torch").score == 50
    # 1 partial of 3 total weight units: 0.5/3*100 = 16.67 -> 17
    assert score([req("PyTorch"), req("Rust", 2)], "used torch").score == 17
    # 0.5/4*100 = 12.5 -> 13 (half up)
    assert score([req("PyTorch"), req("Rust", 3)], "used torch").score == 13


def test_alias_and_stem_are_partial():
    assert status_of("JavaScript", "wrote JS widgets") == "partial"
    assert status_of("Kubernetes", "ran k8s clusters") == "partial"
    assert status_of("PostgreSQL", "tuned postgres") == "partial"
    assert status_of("machine learning", "applied ML models") == "partial"
    assert status_of("testing", "wrote unit tests") == "partial"
    assert status_of("deployments", "automated deploy pipelines") == "partial"
    assert status_of("deploy", "weekly deployments") == "partial"


def test_exact_beats_alias():
    assert status_of("PyTorch", "PyTorch and torch") == "matched"


def test_special_character_terms():
    assert status_of("C", "Languages: C, C++, Rust") == "matched"
    assert status_of("C", "Languages: C++ and C#") == "missing"
    assert status_of("C++", "Languages: C++, Rust") == "matched"
    assert status_of("C++", "Languages: C and Rust") == "missing"
    assert status_of("C#", "wrote C# services") == "matched"
    assert status_of(".NET", "built .NET apps") == "matched"
    assert status_of("Node.js", "backend in Node.js.") == "matched"
    assert status_of("Node.js", "backend in nodejs") == "partial"
    assert status_of("JavaScript", "Node.js backend") == "missing"


def test_multiword_flexible_whitespace_and_hyphen():
    assert status_of("machine learning", "machine   learning") == "matched"
    assert status_of("machine learning", "machine-\nlearning") == "matched"
    assert status_of("full-stack", "full stack engineer") == "matched"
    assert status_of("machine learning", "learning machines") == "missing"


def test_latex_comments_ignored_but_escaped_percent_kept():
    assert status_of("Rust", "Go % Rust is a comment\nPython") == "missing"
    assert status_of("Rust", "Improved 50\\% with Rust") == "matched"
    assert status_of("50%", "Improved 50\\% overall") == "matched"


def test_latex_commands_stripped():
    assert status_of("PyTorch", r"\textbf{PyTorch}, \emph{Docker}") == "matched"
    assert status_of("Docker", r"\textbf{PyTorch}, \emph{Docker}") == "matched"
    assert status_of("section", r"\section{Experience}") == "missing"
    assert status_of("Experience", r"\section{Experience}") == "matched"
    assert status_of("C#", r"wrote C\# code") == "matched"
    assert status_of("textbf", r"\textbf{bold}") == "missing"
    assert status_of("href", r"\href{http://x.com}{Rust}") == "missing"


def test_strip_latex_directly():
    assert "section" not in strip_latex(r"\section*{Skills} % hidden").lower().replace("skills", "")
    assert strip_latex(r"A \\ B") .split() == ["A", "B"]


def test_match_status_uses_score_rules_on_plain_text():
    from app.scoring import match_status

    assert match_status("Python", "Wrote PYTHON daily") == "matched"
    assert match_status("Kubernetes", "ran k8s clusters") == "partial"
    assert match_status("deployment", "deployed services") == "partial"
    assert match_status("Java", "JavaScript only") == "missing"
    for term, text in [("C++", "C++ and C"), ("Rust", "Rust"), ("ML", "machine learning")]:
        assert match_status(term, text) == score([req(term)], text).matches[0].status


def test_exact_or_alias_has_no_stem_fallback():
    from app.scoring import exact_or_alias

    assert exact_or_alias("Python", "wrote python")
    assert exact_or_alias("Kubernetes", "ran k8s")
    assert not exact_or_alias("React", "Reacted quickly")
    assert not exact_or_alias("deployment", "deployed services")
    # score() and match_status keep their stem-lenient grading.
    assert status_of("React", "Reacted quickly") == "partial"


# --- only the document body is scored ------------------------------------------------


def test_preamble_package_names_never_match():
    from app.latex.template import render_tex
    from app.models import Profile

    empty = render_tex(Profile(), [], [], {})
    reqs = [Requirement(term=t, kind="skill", weight=2) for t in ("English", "color", "hyperref", "Verbatim")]
    result = score(reqs, empty)
    assert [m.status for m in result.matches] == ["missing"] * 4
    assert result.score == 0


def test_body_text_still_scores_and_text_after_end_document_is_ignored():
    tex = ("\\documentclass{article}\\usepackage[english]{babel}\n\\begin{document}\nPython and English\n"
           "\\end{document}\nKubernetes after the end")
    reqs = [Requirement(term=t, kind="skill", weight=1) for t in ("Python", "English", "Kubernetes")]
    assert [m.status for m in score(reqs, tex).matches] == ["matched", "matched", "missing"]


def test_no_begin_document_scores_the_whole_text():
    reqs = [Requirement(term="Python", kind="skill", weight=1)]
    assert score(reqs, "Built Python services").score == 100
    assert score(reqs, "\\usepackage{python}").matches[0].status == "matched"


def test_potential_score_also_ignores_the_preamble():
    from app.scoring import potential_score

    tex = "\\usepackage{color}\n\\begin{document}\n\\resumeItem{x}\n\\end{document}"
    reqs = [Requirement(term="color", kind="skill", weight=1)]
    assert potential_score(reqs, tex, [("\\resumeItem{x}", "\\resumeItem{y}")]) == 0
