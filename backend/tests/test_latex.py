import shutil
import subprocess
from pathlib import Path

import pytest

from app.latex import compile as compile_mod
from app.latex.compile import CompileError, compile_pdf
from app.latex.escape import escape_latex, safe_url
from app.latex.template import Bullet, render_tex
from app.models import Card, Job, Profile

needs_tectonic = pytest.mark.skipif(
    shutil.which("tectonic") is None,
    reason="tectonic binary not installed (brew install tectonic); real compile path not exercised",
)

SPECIALS = "& % $ # _ { } ~ ^ \\"


def test_escape_all_specials():
    assert escape_latex("&") == r"\&"
    assert escape_latex("%") == r"\%"
    assert escape_latex("$") == r"\$"
    assert escape_latex("#") == r"\#"
    assert escape_latex("_") == r"\_"
    assert escape_latex("{") == r"\{"
    assert escape_latex("}") == r"\}"
    assert escape_latex("~") == r"\textasciitilde{}"
    assert escape_latex("^") == r"\textasciicircum{}"
    assert escape_latex("\\") == r"\textbackslash{}"


def test_escape_backslash_not_double_escaped():
    assert escape_latex(r"a\&b") == r"a\textbackslash{}\&b"
    assert escape_latex(r"\{") == r"\textbackslash{}\{"
    assert escape_latex(r"\textbf{x}") == r"\textbackslash{}textbf\{x\}"


def test_escape_normalizes_control_chars_and_newlines():
    assert escape_latex("a\nb\r\nc\td") == "a b c d"
    assert escape_latex("a\x00b\x07c\x1bd") == "abcd"
    assert escape_latex("a b c\x85d") == "a b c d"
    assert escape_latex("  lots   of \n\n space ") == "lots of space"


def test_escape_preserves_unicode():
    s = "Café – “quoted” naïve résumé 日本語 — ok"
    assert escape_latex(s) == s


def test_safe_url_rules():
    assert safe_url("https://a.com/x?y=1&z=2#f_g~h%20") == (
        r"https://a.com/x?y=1\&z=2\#f\_g\~h\%20")
    assert safe_url("github.com/me") == "https://github.com/me"
    assert safe_url("https://a.com/\nevil") is None
    assert safe_url("https://a.com/\\input{x}") is None
    assert safe_url("javascript:alert(1)") is None
    assert safe_url("file:///etc/passwd") is None
    assert safe_url("") is None
    # braces / caret / dollar / space are percent-encoded, not passed through
    out = safe_url("https://a.com/a b{c}^d$")
    assert out == r"https://a.com/a\%20b\%7Bc\%7D\%5Ed\%24"


def _fixture():
    profile = Profile(name="Ann & Co", email="ann@x.com", phone="555-1234",
                      links=["github.com/ann_x", "javascript:alert(1)"])
    jobs = [Job(id=1, company="R&D 50% Inc", title="Dev", location="NYC",
                start_date="Jan 2020", end_date=""),
            Job(id=2, company="Other", title="Intern", start_date="2019", end_date="2020")]
    cards = {
        "education": [Card(id=10, kind="education", title="MIT", description="BS CS",
                           extra={"location": "Cambridge, MA", "start_date": "2016",
                                  "end_date": "2020"})],
        "projects": [Card(id=11, kind="project", title="Proj_1", tags=["Python", "C#"],
                          extra={"start_date": "2021", "end_date": "2022"})],
        "skills": [Card(id=12, kind="skill", title="Python", extra={"category": "Languages"}),
                   Card(id=13, kind="skill", title="C++", extra={"category": "Languages"}),
                   Card(id=14, kind="skill", title="Git", extra={})],
    }
    bullets = [
        Bullet("experience", 1, "R&D at 50% # of $ _x_", 100),
        Bullet("experience", 1, "line one\nline two", 101),
        Bullet("experience", 2, "Second job bullet", 102),
        Bullet("projects", None, "Proj bullet ~ ^ \\", 11),
    ]
    return profile, jobs, bullets, cards


def test_render_escapes_user_text():
    tex = render_tex(*_fixture())
    assert r"\resumeItem{R\&D at 50\% \# of \$ \_x\_}" in tex
    assert r"R&D" not in tex.replace(r"R\&D", "")
    assert r"Ann \& Co" in tex
    assert r"\textasciitilde{} \textasciicircum{} \textbackslash{}" in tex
    assert r"\href{javascript" not in tex
    assert r"\href{https://github.com/ann\_x}" in tex


def test_each_bullet_on_own_line():
    tex = render_tex(*_fixture())
    lines = [ln for ln in tex.splitlines() if r"\resumeItem{" in ln]
    body = [ln for ln in lines if not ln.lstrip().startswith("%")
            and r"\newcommand" not in ln]
    assert len(body) == 4
    for ln in body:
        assert ln.strip().startswith(r"\resumeItem{") and ln.strip().endswith("}")
    assert r"\resumeItem{line one line two}" in tex
    # stable ordering, deterministic output
    assert tex == render_tex(*_fixture())
    assert tex.index("R\\&D at") < tex.index("line one") < tex.index("Second job")


def test_sections_and_omission():
    tex = render_tex(*_fixture())
    for s in ("Education", "Experience", "Projects", "Technical Skills"):
        assert rf"\section{{{s}}}" in tex
    assert r"\section{Certifications}" not in tex
    assert r"\textbf{Languages}{: Python, C++}" in tex
    assert tex.count(r"\begin{document}") == 1 and tex.rstrip().endswith(r"\end{document}")
    assert "Jun" not in tex  # no sample content from the vendored template
    empty = render_tex(Profile(name="Solo"), [], [], {})
    for s in ("Education", "Experience", "Projects", "Technical Skills", "Certifications"):
        assert rf"\section{{{s}}}" not in empty
    assert r"\textbf{\Huge \scshape Solo}" in empty
    # a job with no bullets must not emit an empty itemize (LaTeX error)
    only_job = render_tex(Profile(name="S"), [Job(id=1, company="C", title="T")], [], {})
    assert r"\resumeItemListStart" not in only_job.split(r"\begin{document}")[1]
    certs = render_tex(Profile(name="S"), [], [], {
        "certifications": [Card(id=1, kind="certificate", title="AWS_SA", description="Amazon")]})
    assert r"\section{Certifications}" in certs and r"AWS\_SA" in certs


def test_glyphtounicode_is_guarded():
    tex = render_tex(Profile(name="S"), [], [], {})
    pre = tex.split(r"\begin{document}")[0]
    assert r"\ifdefined\pdfgentounicode" in pre and "glyphtounicode" in pre


def _stub_run(monkeypatch, *, returncode=0, output="", write_pdf=True, raises=None, pdf=b"%PDF-1.5 stub",
              before=None):
    """Stands in for subprocess.run. Output goes where compile_pdf asked for it: into the file
    objects passed as stdout/stderr, or (older call style) the CompletedProcess."""
    seen = {}

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        cwd = Path(kw["cwd"])
        seen["cwd"] = cwd
        seen["tex"] = (cwd / "main.tex").read_text(encoding="utf-8")
        if before:
            before()
        out = kw.get("stdout")
        to_file = hasattr(out, "write")
        if to_file and output:
            out.write(output.encode() if isinstance(output, str) else output)
            out.flush()
        if raises:
            raise raises
        if write_pdf:
            (cwd / "main.pdf").write_bytes(pdf)
        return subprocess.CompletedProcess(cmd, returncode, stdout=None if to_file else output, stderr=None if to_file else "")

    monkeypatch.setattr(compile_mod.subprocess, "run", run)
    return seen


def test_compile_runs_tectonic_safely_and_cleans_up(monkeypatch):
    seen = _stub_run(monkeypatch)
    assert compile_pdf("hello é").startswith(b"%PDF")
    assert isinstance(seen["cmd"], list) and seen["cmd"][0] == "tectonic"
    assert "--untrusted" in seen["cmd"]
    assert not seen["kw"].get("shell")
    assert seen["kw"]["timeout"] == 30
    assert seen["tex"] == "hello é"
    assert not seen["cwd"].exists()


def test_compile_error_cleans_up_and_truncates_log(monkeypatch):
    seen = _stub_run(monkeypatch, returncode=1, output="x" * 50_000 + "error: Undefined control sequence",
                     write_pdf=False)
    with pytest.raises(CompileError) as e:
        compile_pdf(r"\bad")
    assert "Undefined control sequence" in e.value.log and len(e.value.log) < 10_000
    assert not seen["cwd"].exists()


def test_compile_maps_timeout_and_missing_binary(monkeypatch):
    _stub_run(monkeypatch, output="partial-log-line", raises=subprocess.TimeoutExpired("tectonic", 30))
    with pytest.raises(CompileError, match="timed out") as e:
        compile_pdf("x")
    assert "partial-log-line" in e.value.log
    _stub_run(monkeypatch, raises=FileNotFoundError("tectonic"))
    with pytest.raises(CompileError, match="brew install tectonic"):
        compile_pdf("x")
    _stub_run(monkeypatch, returncode=0, write_pdf=False)
    with pytest.raises(CompileError):
        compile_pdf("x")


@needs_tectonic
def test_compile_valid_tex_returns_pdf_bytes():
    pdf = compile_pdf("\\documentclass{article}\\begin{document}Hi\\end{document}")
    assert pdf.startswith(b"%PDF")


@needs_tectonic
def test_compile_broken_tex_raises_with_log():
    with pytest.raises(CompileError) as e:
        compile_pdf("\\documentclass{article}\\begin{document}\\nonsense\\end{document}")
    assert e.value.log


@needs_tectonic
def test_special_characters_resume_compiles():
    nasty = "R&D 50% # $ _ { } ~ ^ \\ \\textbf{x} é “q” – end"
    profile, jobs, bullets, cards = _fixture()
    bullets.append(Bullet("experience", 1, nasty, 103))
    assert compile_pdf(render_tex(profile, jobs, bullets, cards)).startswith(b"%PDF")


def test_compile_route_ok(client, monkeypatch):
    _stub_run(monkeypatch)
    r = client.post("/api/latex/compile", json={"tex": "x"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_compile_route_422_on_error(client, monkeypatch):
    _stub_run(monkeypatch, returncode=1, output="! Undefined control sequence.", write_pdf=False)
    r = client.post("/api/latex/compile", json={"tex": r"\garbage"})
    assert r.status_code == 422
    assert "Undefined control sequence" in r.json()["detail"]["log"]


def test_compile_route_garbage_and_size_cap(client, monkeypatch):
    _stub_run(monkeypatch, returncode=1, output="boom", write_pdf=False)
    r = client.post("/api/latex/compile", json={"tex": "\x00�}}}{{\\"})
    assert r.status_code == 422 and r.json()["detail"]["log"] == "boom"
    big = "a" * 200_001
    r = client.post("/api/latex/compile", json={"tex": big})
    assert r.status_code == 422 and big[:50] not in r.text
    assert client.post("/api/latex/compile", json={}).status_code == 422


# --- output caps and concurrency (stubbed: Tectonic is not installed here) ------------------


def test_compile_output_goes_to_files_and_only_the_tail_is_read(monkeypatch):
    huge = "noise line\n" * 500_000 + "! LaTeX Error: the real problem"  # ~5.5 MB
    seen = _stub_run(monkeypatch, returncode=1, output=huge, write_pdf=False)
    reads = []
    real_read = compile_mod._tail
    monkeypatch.setattr(compile_mod, "_tail", lambda f: reads.append(1) or real_read(f))
    with pytest.raises(CompileError) as e:
        compile_pdf("x")
    assert "capture_output" not in seen["kw"]
    assert hasattr(seen["kw"]["stdout"], "write") and seen["kw"]["stderr"] is subprocess.STDOUT
    assert e.value.log.endswith("the real problem") and len(e.value.log) < 10_000
    assert reads


def test_tail_reads_at_most_the_cap(tmp_path):
    f = (tmp_path / "out").open("w+b")
    f.write(b"a" * 1_000_000 + b"END")
    assert compile_mod._tail(f).endswith("END")
    assert len(compile_mod._tail(f)) <= compile_mod.MAX_OUTPUT_BYTES


def test_oversized_pdf_is_rejected_before_reading(monkeypatch):
    monkeypatch.setattr(compile_mod, "MAX_PDF_BYTES", 1000)
    _stub_run(monkeypatch, pdf=b"%PDF" + b"0" * 5000)
    monkeypatch.setattr(Path, "read_bytes", lambda self: pytest.fail("read an oversized PDF"))
    with pytest.raises(CompileError, match="larger than"):
        compile_pdf("x")


def test_pdf_cap_is_ten_megabytes():
    assert compile_mod.MAX_PDF_BYTES == 10 * 1024 * 1024


def test_at_most_two_compiles_run_at_once_and_a_third_gets_busy(monkeypatch):
    import threading

    monkeypatch.setattr(compile_mod, "QUEUE_WAIT_S", 0.2)
    started = threading.Semaphore(0)
    release = threading.Event()
    running = []
    peak = []

    def hold():
        running.append(1)
        peak.append(len(running))
        started.release()
        release.wait(5)
        running.pop()

    _stub_run(monkeypatch, before=hold)
    results = []
    threads = [threading.Thread(target=lambda: results.append(compile_pdf("x"))) for _ in range(2)]
    for t in threads:
        t.start()
    assert started.acquire(timeout=5) and started.acquire(timeout=5)
    with pytest.raises(compile_mod.CompilerBusy):
        compile_pdf("x")
    release.set()
    for t in threads:
        t.join(5)
    assert len(results) == 2 and max(peak) == 2
    assert compile_pdf("x").startswith(b"%PDF")  # slots are freed again


def test_third_compile_waits_for_a_free_slot(monkeypatch):
    import threading

    monkeypatch.setattr(compile_mod, "QUEUE_WAIT_S", 5)
    started = threading.Semaphore(0)
    release = threading.Event()
    calls = []

    def hold():
        calls.append(1)
        if len(calls) <= 2:
            started.release()
            release.wait(5)

    _stub_run(monkeypatch, before=hold)
    threads = [threading.Thread(target=lambda: compile_pdf("x")) for _ in range(2)]
    for t in threads:
        t.start()
    assert started.acquire(timeout=5) and started.acquire(timeout=5)
    threading.Timer(0.2, release.set).start()
    assert compile_pdf("x").startswith(b"%PDF")
    for t in threads:
        t.join(5)


def test_compile_route_503_when_busy(client, monkeypatch):
    def busy(_tex):
        raise compile_mod.CompilerBusy()

    monkeypatch.setattr("app.routes.latex.compile_pdf", busy)
    r = client.post("/api/latex/compile", json={"tex": "x"})
    assert r.status_code == 503
    assert "busy" in r.json()["detail"].lower()


def test_untrusted_comment_is_accurate():
    src = Path(compile_mod.__file__).read_text()
    assert "other insecure features" not in src
    assert "shell-escape" in src
